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
import { fetchColumnValues } from '../superset/polling.js';
import { logger } from '../logger.js';
import { cache } from '../cache/index.js';
import type { PositionNode, PositionJson } from '../superset/types.js';
import type { AppContext } from '../auth/context.js';

interface SupersetDashboard {
  id: number;
  dashboard_title: string;
  slug: string | null;
  published: boolean;
  position_json?: string;
  json_metadata?: string;
}

interface DashboardListResponse {
  result: SupersetDashboard[];
  count: number;
}

interface DashboardResponse {
  result: SupersetDashboard;
}

function mapDashboard(d: SupersetDashboard) {
  return {
    id: String(d.id),
    title: d.dashboard_title,
    slug: d.slug ?? null,
    published: d.published,
  };
}

const POSITION_CACHE_TTL_S = 300;

export function parseTabs(pos: PositionJson): Array<{ id: string; name: string }> {
  return Object.values(pos)
    .filter((node): node is PositionNode => node.type === 'TAB')
    .map((node) => ({
      id: node.id,
      name: node.meta?.text ?? node.meta?.defaultText ?? node.id,
    }));
}

export function getChartIdsInTab(pos: PositionJson, tabId: string): Set<number> {
  const ids = new Set<number>();
  for (const node of Object.values(pos)) {
    if (
      node.type === 'CHART' &&
      node.parents?.includes(tabId) === true &&
      typeof node.meta?.chartId === 'number'
    ) {
      ids.add(node.meta.chartId);
    }
  }
  return ids;
}

interface DashboardDetail {
  position: PositionJson | null;
  jsonMetadata: Record<string, unknown> | null;
}

/**
 * 取 dashboard 詳情並解析 position_json + json_metadata（單一 REST、共用 cache）。
 * tabs / charts(tab:) 用 position；filters 用 jsonMetadata。
 */
async function fetchDashboardDetail(dashboardId: string): Promise<DashboardDetail> {
  const cacheKey = `dashboard:${dashboardId}:detail`;
  const hit = cache.get(cacheKey);
  if (hit) {
    logger.debug({ dashboardId }, 'dashboard detail cache hit');
    return JSON.parse(hit) as DashboardDetail;
  }
  const data = await supersetClient.get<{
    result: { position_json?: string; json_metadata?: string };
  }>(`/api/v1/dashboard/${dashboardId}`);
  const detail: DashboardDetail = {
    position: data.result.position_json
      ? (JSON.parse(data.result.position_json) as PositionJson)
      : null,
    jsonMetadata: data.result.json_metadata
      ? (JSON.parse(data.result.json_metadata) as Record<string, unknown>)
      : null,
  };
  cache.set(cacheKey, JSON.stringify(detail), POSITION_CACHE_TTL_S);
  return detail;
}

async function fetchPositionJson(dashboardId: string): Promise<PositionJson | null> {
  return (await fetchDashboardDetail(dashboardId)).position;
}

// ---- native filter 解析 ----

interface NativeFilterTarget {
  column?: { name?: string };
  datasetId?: number;
}

interface NativeFilterConfig {
  id: string;
  name: string;
  filterType?: string;
  targets?: NativeFilterTarget[];
  defaultDataMask?: { filterState?: { value?: unknown } };
  controlValues?: { multiSelect?: boolean };
}

/** Dashboard.filters resolver 回傳的形狀（datasetId 為內部欄位，不暴露在 schema）*/
export interface DashboardFilterShape {
  id: string;
  name: string;
  column: string | null;
  type: string;
  defaultValue: unknown;
  multiple: boolean;
  datasetId: number | null;
}

export function parseNativeFilters(meta: Record<string, unknown>): DashboardFilterShape[] {
  const configs = meta.native_filter_configuration;
  if (!Array.isArray(configs)) return [];
  return (configs as NativeFilterConfig[]).map((f) => ({
    id: f.id,
    name: f.name,
    column: f.targets?.[0]?.column?.name ?? null,
    type: f.filterType ?? '',
    defaultValue: f.defaultDataMask?.filterState?.value ?? null,
    multiple: f.controlValues?.multiSelect ?? true,
    datasetId: f.targets?.[0]?.datasetId ?? null,
  }));
}

function buildRisonFilter(search?: string | null, page = 0, pageSize = 25): string {
  const parts: string[] = [
    `page:${page}`,
    `page_size:${pageSize}`,
    `order_column:dashboard_title`,
    `order_direction:asc`,
  ];
  if (search) {
    const escaped = search.replace(/'/g, "\\'");
    parts.push(`filters:!((col:dashboard_title,opr:ct,value:'${escaped}'))`);
  }
  return `(${parts.join(',')})`;
}

export const dashboardResolvers = {
  Query: {
    async dashboards(
      _parent: unknown,
      args: { search?: string | null; page?: number; pageSize?: number },
    ) {
      const q = encodeURIComponent(buildRisonFilter(args.search, args.page ?? 0, args.pageSize ?? 25));
      logger.debug({ search: args.search, page: args.page }, 'dashboards query');
      const data = await supersetClient.get<DashboardListResponse>(
        `/api/v1/dashboard/?q=${q}`,
      );
      return data.result.map(mapDashboard);
    },

    async dashboard(_parent: unknown, args: { id: string }) {
      logger.debug({ id: args.id }, 'dashboard query');
      const data = await supersetClient.get<DashboardResponse>(
        `/api/v1/dashboard/${args.id}`,
      );
      return mapDashboard(data.result);
    },
  },

  Dashboard: {
    async tabs(parent: { id: string }) {
      const pos = await fetchPositionJson(parent.id);
      if (!pos) return [];
      return parseTabs(pos);
    },

    async charts(parent: { id: string }, args: { tab?: string | null }) {
      const data = await supersetClient.get<{ result: SupersetChart[] }>(
        `/api/v1/dashboard/${parent.id}/charts`,
      );
      const allCharts = data.result.map(mapChart);
      if (!args.tab) return allCharts;

      const pos = await fetchPositionJson(parent.id);
      if (!pos) return allCharts;

      const allowed = getChartIdsInTab(pos, args.tab);
      return allCharts.filter((c) => allowed.has(Number(c.id)));
    },

    async filters(parent: { id: string }) {
      const detail = await fetchDashboardDetail(parent.id);
      if (!detail.jsonMetadata) return [];
      return parseNativeFilters(detail.jsonMetadata);
    },
  },

  DashboardFilter: {
    async values(
      parent: DashboardFilterShape,
      args: { limit?: number | null },
      ctx: AppContext,
    ) {
      if (!parent.column || parent.datasetId == null) return [];
      return fetchColumnValues(
        parent.datasetId,
        parent.column,
        args.limit ?? 1000,
        ctx.scope?.scopeKey,
      );
    },
  },
};

// Shared type needed by Dashboard.charts resolver
// /api/v1/dashboard/{id}/charts returns viz_type and datasource inside form_data
interface SupersetChart {
  id: number;
  slice_name: string;
  description: string | null;
  form_data: {
    viz_type?: string;
    datasource?: string; // format: "{id}__table"
  };
}

function mapChart(c: SupersetChart) {
  const datasourceId = c.form_data.datasource
    ? Number(c.form_data.datasource.split('__')[0])
    : null;
  return {
    id: String(c.id),
    name: c.slice_name,
    vizType: c.form_data.viz_type ?? '',
    description: c.description ?? null,
    datasourceId: isNaN(datasourceId ?? NaN) ? null : datasourceId,
  };
}
