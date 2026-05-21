// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

// Shared Superset REST API response types for dataset metadata.
// Consumed by both chart and introspection resolvers.

export interface SupersetDatasetColumn {
  column_name: string;
  verbose_name: string | null;
  type: string | null;
  is_dttm: boolean;
}

export interface SupersetDatasetMetric {
  metric_name: string;
  verbose_name: string | null;
  description: string | null;
}

export interface SupersetDatasetDetail {
  columns: SupersetDatasetColumn[];
  metrics: SupersetDatasetMetric[];
  table_name?: string;
}

export interface SupersetDatasetResponse {
  result: SupersetDatasetDetail;
}
