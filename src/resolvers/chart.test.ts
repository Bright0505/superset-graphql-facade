// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

import { mapColumn, mapMetric } from './chart.js';
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
