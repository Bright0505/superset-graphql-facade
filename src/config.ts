// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().min(1).max(65535).default(4000),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  SUPERSET_URL: z.string().url('SUPERSET_URL 必須是合法的 URL'),
  SUPERSET_USERNAME: z.string().min(1, 'SUPERSET_USERNAME 不可為空'),
  SUPERSET_PASSWORD: z.string().min(1, 'SUPERSET_PASSWORD 不可為空'),
  REDIS_URL: z.string().optional(),
  // 逗號分隔的 "name:key" 格式，例如 "frontend:abc123,partner:xyz789"
  API_KEYS: z.string().default(''),
});

function parseConfig() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`❌ 環境變數設定錯誤:\n${issues}\n\n請參考 .env.example`);
  }
  return result.data;
}

export const config = parseConfig();
export type Config = typeof config;

export function parseApiKeys(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 1) continue;
    const name = trimmed.slice(0, colonIdx).trim();
    const key = trimmed.slice(colonIdx + 1).trim();
    if (name && key) map.set(key, name);
  }
  return map;
}
