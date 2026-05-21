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
import type { SupersetDatasetColumn, SupersetDatasetMetric, SupersetDatasetDetail } from '../superset/types.js';

const INTROSPECTION_CACHE_TTL_S = 300; // 5 分鐘

interface SupersetChartDetail {
  id: number;
  slice_name: string;
  viz_type: string;
  description: string | null;
  datasource_id: number | null;
  query_context: string | null;
}


interface Parameter {
  name: string;
  label: string | null;
  type: string | null;
  isMetric: boolean;
  description: string | null;
}

export function buildDescription(
  chart: SupersetChartDetail,
  dataset: SupersetDatasetDetail | null,
): string {
  const parts: string[] = [];

  if (chart.description?.trim()) {
    parts.push(chart.description.trim());
  } else {
    parts.push(`${chart.slice_name}（${chart.viz_type} 圖表）`);
  }

  if (dataset) {
    const metrics = dataset.metrics.map(
      (m) => m.verbose_name ?? m.metric_name,
    );
    const dims = dataset.columns
      .filter((c) => !c.is_dttm)
      .map((c) => c.verbose_name ?? c.column_name)
      .slice(0, 6);
    const timeCols = dataset.columns
      .filter((c) => c.is_dttm)
      .map((c) => c.verbose_name ?? c.column_name);

    if (metrics.length > 0) {
      parts.push(`指標：${metrics.slice(0, 5).join('、')}`);
    }
    if (dims.length > 0) {
      parts.push(`維度：${dims.join('、')}`);
    }
    if (timeCols.length > 0) {
      parts.push(`時間欄位：${timeCols.join('、')}`);
    }
  }

  return parts.join('。');
}

export function buildParameters(dataset: SupersetDatasetDetail | null): Parameter[] {
  if (!dataset) return [];

  const params: Parameter[] = [];

  for (const col of dataset.columns) {
    params.push({
      name: col.column_name,
      label: col.verbose_name ?? null,
      type: col.is_dttm ? 'DATETIME' : (col.type ?? 'STRING'),
      isMetric: false,
      description: col.is_dttm ? '可用於時間區間篩選' : null,
    });
  }

  for (const m of dataset.metrics) {
    params.push({
      name: m.metric_name,
      label: m.verbose_name ?? null,
      type: 'NUMERIC',
      isMetric: true,
      description: m.description ?? null,
    });
  }

  return params;
}

export function buildExampleQuery(chartId: string, chartName: string): string {
  return [
    `# ${chartName}`,
    `query {`,
    `  chart(id: "${chartId}") {`,
    `    name`,
    `    vizType`,
    `    columns { name label type isMetric }`,
    `    data {`,
    `      rowCount`,
    `      columnNames`,
    `      rows`,
    `      cached`,
    `      cachedAt`,
    `    }`,
    `  }`,
    `}`,
  ].join('\n');
}

export const introspectionResolvers = {
  Query: {
    async chartIntrospection(_parent: unknown, args: { id: string }) {
      const { id } = args;
      const cacheKey = `chart:${id}:introspection`;

      const hit = cache.get(cacheKey);
      if (hit) {
        logger.debug({ chartId: id }, 'chartIntrospection cache hit');
        return JSON.parse(hit) as unknown;
      }

      logger.debug({ chartId: id }, 'chartIntrospection query');

      const chartRes = await supersetClient.get<{ result: SupersetChartDetail }>(
        `/api/v1/chart/${id}`,
      );
      const chart = chartRes.result;

      let dataset: SupersetDatasetDetail | null = null;
      if (chart.datasource_id) {
        try {
          const dsRes = await supersetClient.get<{ result: SupersetDatasetDetail }>(
            `/api/v1/dataset/${chart.datasource_id}`,
          );
          dataset = dsRes.result;
        } catch (err) {
          logger.warn({ chartId: id, datasourceId: chart.datasource_id, err }, 'Failed to fetch dataset for introspection');
        }
      }

      const result = {
        chartId: String(chart.id),
        chartName: chart.slice_name,
        vizType: chart.viz_type,
        description: buildDescription(chart, dataset),
        parameters: buildParameters(dataset),
        exampleQuery: buildExampleQuery(String(chart.id), chart.slice_name),
      };

      cache.set(cacheKey, JSON.stringify(result), INTROSPECTION_CACHE_TTL_S);
      return result;
    },
  },
};
