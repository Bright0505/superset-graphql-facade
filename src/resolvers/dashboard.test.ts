// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

import { parseTabs, getChartIdsInTab } from './dashboard.js';
import type { PositionJson } from '../superset/types.js';

const samplePosition: PositionJson = {
  ROOT_ID: { id: 'ROOT_ID', type: 'ROOT', children: ['GRID_ID'] },
  GRID_ID: { id: 'GRID_ID', type: 'GRID', children: ['TABS-abc'] },
  'TABS-abc': { id: 'TABS-abc', type: 'TABS', children: ['TAB-def', 'TAB-ghi'] },
  'TAB-def': {
    id: 'TAB-def',
    type: 'TAB',
    meta: { text: '銷售分析', defaultText: 'Tab 1' },
    children: ['ROW-xxx'],
  },
  'TAB-ghi': {
    id: 'TAB-ghi',
    type: 'TAB',
    meta: { defaultText: 'Tab 2' },
    children: [],
  },
  'TAB-nometadata': {
    id: 'TAB-nometadata',
    type: 'TAB',
    children: [],
  },
  'ROW-xxx': { id: 'ROW-xxx', type: 'ROW', children: ['CHART-111', 'CHART-222'] },
  'CHART-111': {
    id: 'CHART-111',
    type: 'CHART',
    meta: { chartId: 123 },
    parents: ['ROOT_ID', 'GRID_ID', 'TABS-abc', 'TAB-def', 'ROW-xxx'],
  },
  'CHART-222': {
    id: 'CHART-222',
    type: 'CHART',
    meta: { chartId: 456 },
    parents: ['ROOT_ID', 'GRID_ID', 'TABS-abc', 'TAB-def', 'ROW-xxx'],
  },
  'CHART-333': {
    id: 'CHART-333',
    type: 'CHART',
    meta: { chartId: 789 },
    parents: ['ROOT_ID', 'GRID_ID', 'TABS-abc', 'TAB-ghi', 'ROW-yyy'],
  },
  'CHART-nometa': {
    id: 'CHART-nometa',
    type: 'CHART',
    parents: ['TAB-def'],
  },
};

// ---- parseTabs ----

test('parseTabs returns one entry per TAB node', () => {
  const tabs = parseTabs(samplePosition);
  expect(tabs).toHaveLength(3);
});

test('parseTabs uses meta.text when available', () => {
  const tabs = parseTabs(samplePosition);
  const def = tabs.find((t) => t.id === 'TAB-def');
  expect(def?.name).toBe('銷售分析');
});

test('parseTabs falls back to meta.defaultText when text is absent', () => {
  const tabs = parseTabs(samplePosition);
  const ghi = tabs.find((t) => t.id === 'TAB-ghi');
  expect(ghi?.name).toBe('Tab 2');
});

test('parseTabs falls back to node id when both text fields are absent', () => {
  const tabs = parseTabs(samplePosition);
  const noMeta = tabs.find((t) => t.id === 'TAB-nometadata');
  expect(noMeta?.name).toBe('TAB-nometadata');
});

test('parseTabs returns empty array on empty position', () => {
  expect(parseTabs({})).toEqual([]);
});

test('parseTabs does not include non-TAB nodes', () => {
  const tabs = parseTabs(samplePosition);
  expect(tabs.every((t) => t.id.startsWith('TAB'))).toBe(true);
});

// ---- getChartIdsInTab ----

test('getChartIdsInTab returns chart IDs for TAB-def', () => {
  const ids = getChartIdsInTab(samplePosition, 'TAB-def');
  expect(ids).toEqual(new Set([123, 456]));
});

test('getChartIdsInTab returns only chart in TAB-ghi', () => {
  const ids = getChartIdsInTab(samplePosition, 'TAB-ghi');
  expect(ids).toEqual(new Set([789]));
});

test('getChartIdsInTab returns empty set for unknown tab', () => {
  const ids = getChartIdsInTab(samplePosition, 'TAB-nonexistent');
  expect(ids.size).toBe(0);
});

test('getChartIdsInTab skips CHART nodes without meta.chartId', () => {
  const ids = getChartIdsInTab(samplePosition, 'TAB-def');
  expect([...ids].every((id) => typeof id === 'number' && !isNaN(id))).toBe(true);
  expect(ids.size).toBe(2);
});

test('getChartIdsInTab returns empty set on empty position', () => {
  expect(getChartIdsInTab({}, 'TAB-def').size).toBe(0);
});
