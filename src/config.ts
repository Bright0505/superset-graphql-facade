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
  // 每個 API key 每分鐘最大請求數，0 = 停用 rate limit
  RATE_LIMIT_RPM: z.coerce.number().min(0).default(60),

  // --- per-scope 資料認證（方案 A — 範圍帳號）---
  // 'service-account'（預設）= 維持現有單一服務帳號行為（不影響任何既有功能）
  // 'per-scope'              = chart data 查詢走範圍帳號，由 Superset RBAC+RLS 執法
  DATA_AUTH_MODE: z.enum(['service-account', 'per-scope']).default('service-account'),

  // JWKS 端點：驗證 App 端傳入的使用者 IdP token（X-User-Token header）
  // 未設定時跳過簽章驗證（僅 decode，僅用於開發）
  USER_JWT_JWKS_URI: z.string().url().optional(),
  USER_JWT_ISSUER: z.string().optional(),
  USER_JWT_AUDIENCE: z.string().optional(),
  // IdP JWT 中代表 scopeKey 的 claim 欄位名稱，預設 "region"
  USER_JWT_SCOPE_CLAIM: z.string().default('region'),

  // JSON 物件：{ "scopeKey": "superset-username:superset-password" }
  // 例：{ "中投一區": "scope_ztyi1:P@ssword", "商場一部": "scope_mall1:P@ssword" }
  // ⚠️ 含密碼，絕不 log，請用 Secret Manager / Vault 注入
  SCOPE_CREDENTIALS: z.string().default('{}'),
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

/** 解析 SCOPE_CREDENTIALS JSON → Map<scopeKey, {username, password}> */
export function parseScopeCredentials(
  raw: string,
): Map<string, { username: string; password: string }> {
  const map = new Map<string, { username: string; password: string }>();
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(raw) as Record<string, string>;
  } catch {
    return map;
  }
  for (const [scopeKey, cred] of Object.entries(parsed)) {
    const colonIdx = cred.indexOf(':');
    if (colonIdx < 1) continue;
    const username = cred.slice(0, colonIdx).trim();
    const password = cred.slice(colonIdx + 1).trim();
    if (username && password) map.set(scopeKey, { username, password });
  }
  return map;
}
