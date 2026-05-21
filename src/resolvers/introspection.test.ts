// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

import { buildDescription, buildParameters, buildExampleQuery } from './introspection.js';
import type { SupersetDatasetDetail } from '../superset/types.js';

const mockDataset: SupersetDatasetDetail = {
  table_name: 'sales',
  columns: [
    { column_name: 'order_date', verbose_name: '訂單日期', type: 'DATETIME', is_dttm: true },
    { column_name: 'region', verbose_name: '地區', type: 'STRING', is_dttm: false },
    { column_name: 'product', verbose_name: null, type: 'STRING', is_dttm: false },
  ],
  metrics: [
    { metric_name: 'sum__revenue', verbose_name: '總收入', description: '所有訂單收入加總' },
    { metric_name: 'count', verbose_name: null, description: null },
  ],
};

const mockChart = {
  id: 42,
  slice_name: '銷售儀表板',
  viz_type: 'bar',
  description: null,
  datasource_id: 1,
  query_context: null,
};

test('buildDescription uses chart description when present', () => {
  const chart = { ...mockChart, description: '這是自訂描述' };
  expect(buildDescription(chart, null)).toBe('這是自訂描述');
});

test('buildDescription falls back to chart name + viz_type when description is absent', () => {
  const desc = buildDescription(mockChart, null);
  expect(desc).toContain('銷售儀表板');
  expect(desc).toContain('bar');
});

test('buildDescription includes metrics, dimensions, and time columns', () => {
  const desc = buildDescription(mockChart, mockDataset);
  expect(desc).toContain('總收入');
  expect(desc).toContain('地區');
  expect(desc).toContain('訂單日期');
});

test('buildParameters returns datetime column with correct type and description', () => {
  const params = buildParameters(mockDataset);
  const dateParam = params.find((p) => p.name === 'order_date');
  expect(dateParam).toBeDefined();
  expect(dateParam?.type).toBe('DATETIME');
  expect(dateParam?.isMetric).toBe(false);
  expect(dateParam?.description).toBeTruthy();
});

test('buildParameters returns metric with isMetric=true and description', () => {
  const params = buildParameters(mockDataset);
  const metric = params.find((p) => p.name === 'sum__revenue');
  expect(metric?.isMetric).toBe(true);
  expect(metric?.type).toBe('NUMERIC');
  expect(metric?.description).toBe('所有訂單收入加總');
});

test('buildParameters returns empty array when dataset is null', () => {
  expect(buildParameters(null)).toEqual([]);
});

test('buildExampleQuery contains chartId and chart name as comment', () => {
  const q = buildExampleQuery('42', '銷售儀表板');
  expect(q).toContain('"42"');
  expect(q).toContain('銷售儀表板');
  expect(q).toContain('query {');
});
