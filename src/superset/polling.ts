// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

import { GraphQLError } from 'graphql';
import { supersetClient } from './client.js';
import { createCsrfSession } from './csrf.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { cache } from '../cache/index.js';
import type { ChartFilter } from './types.js';

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 90_000;
const QC_CACHE_TTL_S = 300;  // query_context cache 5 分鐘
const DATA_DEDUP_TTL_S = 60; // data dedup cache 1 分鐘

// ---- Superset API 型別 ----

interface QueryContextQuery {
  filters?: ChartFilter[];
  [key: string]: unknown;
}

interface QueryContext {
  force?: boolean;
  queries?: QueryContextQuery[];
  [key: string]: unknown;
}

interface SupersetChartDataRow {
  [key: string]: unknown;
}

interface SupersetChartDataResult {
  status: string;
  data: SupersetChartDataRow[];
  colnames: string[];
  rowcount: number;
  is_cached: boolean;
  cached_dttm: string | null;
  query: string | null;
}

interface SupersetChartDataResponse {
  status?: string;
  result?: SupersetChartDataResult[];
}

export interface ChartDataPayload {
  rows: SupersetChartDataRow[];
  columnNames: string[];
  rowCount: number;
  cached: boolean;
  cachedAt: string | null;
  query: string | null;
}

// ---- 工具函式 ----

function getStatus(res: SupersetChartDataResponse): string {
  return res.status ?? res.result?.[0]?.status ?? '';
}

function mapResult(res: SupersetChartDataResponse): ChartDataPayload {
  const r = res.result?.[0];
  return {
    rows: r?.data ?? [],
    columnNames: r?.colnames ?? [],
    rowCount: r?.rowcount ?? 0,
    cached: r?.is_cached ?? false,
    cachedAt: r?.cached_dttm ?? null,
    query: r?.query ?? null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- 主流程 ----

/**
 * 取得 chart 實際數值。
 *
 * - force:false → 若 Superset 有快取則直接回傳，否則觸發 async 查詢後 polling
 * - force:true  → 強制重新查詢（忽略 Superset 快取）後 polling
 *
 * polling 流程期間全程使用同一組 CSRF token + cookie（不可重新取得，
 * 否則 async-token channel 會改變）。
 */
export async function fetchChartData(
  chartId: string,
  force: boolean,
  filters?: ChartFilter[],
): Promise<ChartDataPayload> {
  // In-memory dedup cache：避免多個 client 同時打同一 chart
  const filtersHash = JSON.stringify(filters ?? []);
  const dedupKey = `chart:${chartId}:data:${String(force)}:${filtersHash}`;
  if (!force) {
    const hit = cache.get(dedupKey);
    if (hit) {
      logger.debug({ chartId }, 'chart data dedup cache hit');
      return JSON.parse(hit) as ChartDataPayload;
    }
  }

  const start = Date.now();
  const jwt = await supersetClient.getJwt();

  // 每個請求獨立取 CSRF session，避免 async channel 共用
  const { csrfToken, cookieHeader } = await createCsrfSession(jwt);

  // 取 query_context（可 cache 5 分鐘）
  const qcKey = `chart:${chartId}:qc`;
  let queryContextStr = cache.get(qcKey);
  if (!queryContextStr) {
    const chartRes = await supersetClient.get<{
      result: { query_context: string };
    }>(`/api/v1/chart/${chartId}`);
    queryContextStr = chartRes.result.query_context;
    if (queryContextStr) {
      cache.set(qcKey, queryContextStr, QC_CACHE_TTL_S);
    }
  }

  if (!queryContextStr) {
    throw new GraphQLError(`Chart ${chartId} 沒有 query_context，可能尚未在 Superset 儲存`, {
      extensions: { code: 'CHART_NO_QUERY_CONTEXT' },
    });
  }

  const queryContext = JSON.parse(queryContextStr) as QueryContext;

  // 整個流程共用的 headers（包含 CSRF + cookie）
  const headers: Record<string, string> = {
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
    'X-CSRFToken': csrfToken,
    Cookie: cookieHeader,
    Referer: config.SUPERSET_URL,
  };

  // 注入 caller 提供的 filters 到 queries[0].filters（不異動 qc 快取）
  let effectiveQueryContext: QueryContext = queryContext;
  if (filters && filters.length > 0) {
    const baseFilters: ChartFilter[] = queryContext.queries?.[0]?.filters ?? [];
    const mergedQueries: QueryContextQuery[] = [
      {
        ...(queryContext.queries?.[0] ?? {}),
        filters: [...baseFilters, ...filters],
      },
      ...(queryContext.queries?.slice(1) ?? []),
    ];
    effectiveQueryContext = { ...queryContext, queries: mergedQueries };
  }

  // 第一次 POST（force 由 GraphQL client 決定）
  // - force:false → Superset 回傳 cached 結果或 trigger async job
  // - force:true  → Superset 忽略 cache，重新 trigger async job
  const initialBody = JSON.stringify({ ...effectiveQueryContext, force });
  const initialRes = await fetch(`${config.SUPERSET_URL}/api/v1/chart/data`, {
    method: 'POST',
    headers,
    body: initialBody,
  });

  if (!initialRes.ok) {
    throw new GraphQLError(
      `chart/data initial POST failed: HTTP ${initialRes.status}`,
      { extensions: { code: 'SUPERSET_ERROR', httpStatus: initialRes.status } },
    );
  }

  const initialData = (await initialRes.json()) as SupersetChartDataResponse;

  if (getStatus(initialData) !== 'pending') {
    const result = mapResult(initialData);
    cache.set(dedupKey, JSON.stringify(result), DATA_DEDUP_TTL_S);
    logger.debug({ chartId, ms: Date.now() - start }, 'chart data returned immediately');
    return result;
  }

  // Polling loop — 使用同一組 headers（不重新取 CSRF）
  const pollBody = JSON.stringify({ ...effectiveQueryContext, force: false });
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let elapsed = 0;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    elapsed += POLL_INTERVAL_MS;
    logger.debug({ chartId, elapsed }, 'polling chart data');

    const pollRes = await fetch(`${config.SUPERSET_URL}/api/v1/chart/data`, {
      method: 'POST',
      headers,
      body: pollBody,
    });

    if (!pollRes.ok) {
      throw new GraphQLError(
        `chart/data poll failed: HTTP ${pollRes.status}`,
        { extensions: { code: 'SUPERSET_ERROR', httpStatus: pollRes.status } },
      );
    }

    const pollData = (await pollRes.json()) as SupersetChartDataResponse;

    if (getStatus(pollData) !== 'pending') {
      const result = mapResult(pollData);
      cache.set(dedupKey, JSON.stringify(result), DATA_DEDUP_TTL_S);
      logger.info(
        { chartId, ms: Date.now() - start, cached: result.cached },
        'chart data ready',
      );
      return result;
    }
  }

  throw new GraphQLError(
    `Chart ${chartId} 查詢逾時（${POLL_TIMEOUT_MS / 1000}s），請稍後重試`,
    { extensions: { code: 'TIMEOUT', chartId } },
  );
}
