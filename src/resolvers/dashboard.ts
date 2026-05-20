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

interface SupersetDashboard {
  id: number;
  dashboard_title: string;
  slug: string | null;
  published: boolean;
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
    async charts(parent: { id: string }) {
      const data = await supersetClient.get<{ result: SupersetChart[] }>(
        `/api/v1/dashboard/${parent.id}/charts`,
      );
      return data.result.map(mapChart);
    },
  },
};

// Shared type needed by Dashboard.charts resolver
interface SupersetChart {
  id: number;
  slice_name: string;
  viz_type: string;
  description: string | null;
  datasource_id: number | null;
}

function mapChart(c: SupersetChart) {
  return {
    id: String(c.id),
    name: c.slice_name,
    vizType: c.viz_type,
    description: c.description ?? null,
    datasourceId: c.datasource_id ?? null,
  };
}
