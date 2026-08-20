// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

import { mapColumn, mapMetric, parseWrappedChartIds } from './chart.js';
import type { SupersetDatasetColumn, SupersetDatasetMetric } from '../superset/types.js';

test('mapColumn maps a dimension column correctly', () => {
  const col: SupersetDatasetColumn = {
    column_name: 'region',
    verbose_name: '地區',
    type: 'STRING',
    is_dttm: false,
  };
  expect(mapColumn(col)).toEqual({
    name: 'region',
    label: '地區',
    type: 'STRING',
    isMetric: false,
  });
});

test('mapColumn falls back to null when verbose_name and type are absent', () => {
  const col: SupersetDatasetColumn = {
    column_name: 'raw_col',
    verbose_name: null,
    type: null,
    is_dttm: false,
  };
  expect(mapColumn(col)).toEqual({ name: 'raw_col', label: null, type: null, isMetric: false });
});

test('mapMetric always sets type to NUMERIC and isMetric to true', () => {
  const metric: SupersetDatasetMetric = {
    metric_name: 'sum__revenue',
    verbose_name: '總收入',
    description: null,
  };
  expect(mapMetric(metric)).toEqual({
    name: 'sum__revenue',
    label: '總收入',
    type: 'NUMERIC',
    isMetric: true,
  });
});

test('mapMetric falls back label to null when verbose_name is absent', () => {
  const metric: SupersetDatasetMetric = {
    metric_name: 'count',
    verbose_name: null,
    description: null,
  };
  expect(mapMetric(metric)).toEqual({ name: 'count', label: null, type: 'NUMERIC', isMetric: true });
});

// ---- parseWrappedChartIds ----

test('parseWrappedChartIds extracts chart id from a wraps: tag', () => {
  expect(parseWrappedChartIds(['wraps:38825328'])).toEqual([38825328]);
});

test('parseWrappedChartIds is case-insensitive on the prefix', () => {
  expect(parseWrappedChartIds(['WRAPS:123'])).toEqual([123]);
});

test('parseWrappedChartIds collects multiple wraps tags and dedupes', () => {
  const ids = parseWrappedChartIds(['wraps:123', 'wraps:456', 'wraps:123']);
  expect(ids).toEqual([123, 456]);
});

test('parseWrappedChartIds ignores non-matching tags', () => {
  expect(parseWrappedChartIds(['owner:1', 'type:chart', 'wraps:abc', 'wraps:'])).toEqual([]);
});

test('parseWrappedChartIds returns empty array for empty input', () => {
  expect(parseWrappedChartIds([])).toEqual([]);
});
