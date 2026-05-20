// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

export const typeDefs = /* GraphQL */ `
  scalar JSON
  scalar DateTime

  """Superset Dashboard"""
  type Dashboard {
    id: ID!
    title: String!
    slug: String
    published: Boolean!
    "Dashboard 內所有圖表（來自 /api/v1/dashboard/{id}/charts）"
    charts: [Chart!]!
  }

  """Superset Chart（Slice）"""
  type Chart {
    id: ID!
    name: String!
    vizType: String!
    description: String
    "欄位與指標清單（metadata，來自 dataset）"
    columns: [Column!]!
    "查詢實際數值，Façade 內部處理 CSRF + async polling（Phase 2 實作）"
    data(force: Boolean = false): ChartData!
  }

  """欄位定義（維度或指標）"""
  type Column {
    name: String!
    label: String
    "資料型態：STRING / NUMERIC / DATETIME / BOOLEAN"
    type: String
    "true = 指標(metric)，false = 維度(dimension)"
    isMetric: Boolean!
  }

  """圖表查詢結果（來自 /api/v1/chart/data）"""
  type ChartData {
    "資料列，每筆為 JSON object（key 為欄位名稱）"
    rows: [JSON!]!
    "欄位名稱清單，與 rows 每個 key 對應"
    columnNames: [String!]!
    rowCount: Int!
    cached: Boolean!
    cachedAt: DateTime
    "實際執行的 SQL（debug 用）"
    query: String
  }

  """AI Agent / LLM 可讀的圖表 introspection 資訊"""
  type ChartIntrospection {
    chartId: ID!
    chartName: String!
    vizType: String!
    "自然語言描述（chart description + 欄位摘要），適合作為 LLM tool description"
    description: String!
    "可使用的查詢參數（維度、指標、時間欄位）"
    parameters: [Parameter!]!
    "可直接複製執行的 GraphQL query 範例"
    exampleQuery: String!
  }

  """圖表可接受的查詢參數描述"""
  type Parameter {
    name: String!
    label: String
    "DATETIME / STRING / NUMERIC / BOOLEAN"
    type: String
    "true = 指標(metric)，false = 維度(dimension)"
    isMetric: Boolean!
    description: String
  }

  type Query {
    "列出 Dashboard，支援關鍵字搜尋與分頁"
    dashboards(
      search: String
      page: Int = 0
      pageSize: Int = 25
    ): [Dashboard!]!

    "取得單一 Dashboard"
    dashboard(id: ID!): Dashboard

    "取得單一 Chart"
    chart(id: ID!): Chart

    "取得 AI Agent 可讀的圖表 introspection（description + parameters + 範例 query）"
    chartIntrospection(id: ID!): ChartIntrospection!
  }
`;
