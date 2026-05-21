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
import { logger } from '../logger.js';
import { cache } from '../cache/index.js';
import type { PositionNode, PositionJson } from '../superset/types.js';

interface SupersetDashboard {
  id: number;
  dashboard_title: string;
  slug: string | null;
  published: boolean;
  position_json?: string;
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

async function fetchPositionJson(dashboardId: string): Promise<PositionJson | null> {
  const cacheKey = `dashboard:${dashboardId}:position`;
  const hit = cache.get(cacheKey);
  if (hit) {
    logger.debug({ dashboardId }, 'position_json cache hit');
    return JSON.parse(hit) as PositionJson;
  }
  const data = await supersetClient.get<{ result: { position_json?: string } }>(
    `/api/v1/dashboard/${dashboardId}`,
  );
  const raw = data.result.position_json;
  if (!raw) return null;
  const parsed = JSON.parse(raw) as PositionJson;
  cache.set(cacheKey, JSON.stringify(parsed), POSITION_CACHE_TTL_S);
  return parsed;
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
