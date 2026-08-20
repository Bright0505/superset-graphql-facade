// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

import { supersetClient } from '../superset/client.js';
import { fetchChartData } from '../superset/polling.js';
import { logger } from '../logger.js';
import { cache } from '../cache/index.js';
import type { AppContext } from '../auth/context.js';
import type { SupersetDatasetColumn, SupersetDatasetMetric, SupersetDatasetResponse, ChartFilter } from '../superset/types.js';

interface SupersetTag {
  id: number;
  name: string;
  type: number;
}

interface SupersetChart {
  id: number;
  slice_name: string;
  viz_type: string;
  description: string | null;
  datasource_id: number | null;
  tags?: SupersetTag[];
}

interface SupersetChartResponse {
  result: SupersetChart;
}

const TAGS_CACHE_TTL_S = 300;

function mapChart(c: SupersetChart) {
  return {
    id: String(c.id),
    name: c.slice_name,
    vizType: c.viz_type,
    description: c.description ?? null,
    datasourceId: c.datasource_id ?? null,
  };
}

async function fetchChartById(id: string) {
  logger.debug({ id }, 'chart query');
  const data = await supersetClient.get<SupersetChartResponse>(`/api/v1/chart/${id}`);
  return mapChart(data.result);
}

/** 解析 chart 的 Superset tag 名稱，找出 `wraps:<chartId>` 格式所指向的被包覆 chart id */
export function parseWrappedChartIds(tagNames: string[]): number[] {
  const ids = new Set<number>();
  for (const name of tagNames) {
    const match = /^wraps:(\d+)$/i.exec(name);
    if (match) ids.add(Number(match[1]));
  }
  return [...ids];
}

/** 取得 chart 的 tag 名稱清單（5 分鐘快取，沿用 chart:{id}:qc 同等級 TTL）*/
export async function fetchChartTagNames(chartId: string): Promise<string[]> {
  const cacheKey = `chart:${chartId}:tags`;
  const hit = cache.get(cacheKey);
  if (hit) return JSON.parse(hit) as string[];

  const data = await supersetClient.get<SupersetChartResponse>(`/api/v1/chart/${chartId}`);
  const tagNames = (data.result.tags ?? []).map((t) => t.name);
  cache.set(cacheKey, JSON.stringify(tagNames), TAGS_CACHE_TTL_S);
  return tagNames;
}

export function mapColumn(col: SupersetDatasetColumn) {
  return {
    name: col.column_name,
    label: col.verbose_name ?? null,
    type: col.type ?? null,
    isMetric: false,
  };
}

export function mapMetric(m: SupersetDatasetMetric) {
  return {
    name: m.metric_name,
    label: m.verbose_name ?? null,
    type: 'NUMERIC',
    isMetric: true,
  };
}

export const chartResolvers = {
  Query: {
    async chart(_parent: unknown, args: { id: string }) {
      return fetchChartById(args.id);
    },
  },

  Chart: {
    async columns(parent: { datasourceId: number | null }) {
      if (!parent.datasourceId) return [];
      try {
        const data = await supersetClient.get<SupersetDatasetResponse>(
          `/api/v1/dataset/${parent.datasourceId}`,
        );
        const columns = data.result.columns.map(mapColumn);
        const metrics = data.result.metrics.map(mapMetric);
        return [...columns, ...metrics];
      } catch (err) {
        logger.warn({ datasourceId: parent.datasourceId, err }, 'Failed to fetch dataset columns');
        return [];
      }
    },

    async data(
      parent: { id: string },
      args: { force?: boolean | null; filters?: ChartFilter[] | null },
      ctx: AppContext,
    ) {
      return fetchChartData(
        parent.id,
        args.force ?? false,
        args.filters ?? undefined,
        ctx.scope?.scopeKey,
      );
    },

    async wrappedCharts(parent: { id: string }) {
      const tagNames = await fetchChartTagNames(parent.id);
      const wrappedIds = parseWrappedChartIds(tagNames);
      return Promise.all(wrappedIds.map((id) => fetchChartById(String(id))));
    },
  },
};
