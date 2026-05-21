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
import type { SupersetDatasetColumn, SupersetDatasetMetric, SupersetDatasetResponse } from '../superset/types.js';

interface SupersetChart {
  id: number;
  slice_name: string;
  viz_type: string;
  description: string | null;
  datasource_id: number | null;
}

interface SupersetChartResponse {
  result: SupersetChart;
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
      logger.debug({ id: args.id }, 'chart query');
      const data = await supersetClient.get<SupersetChartResponse>(
        `/api/v1/chart/${args.id}`,
      );
      return mapChart(data.result);
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

    async data(parent: { id: string }, args: { force?: boolean | null }) {
      return fetchChartData(parent.id, args.force ?? false);
    },
  },
};
