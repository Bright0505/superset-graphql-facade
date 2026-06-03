// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

/**
 * userToken.ts — 解析 + 驗證 App 端傳入的使用者 IdP token（X-User-Token header）。
 *
 * 設計原則：
 *   - X-User-Token 是「人」的身分；Authorization: Bearer <api-key> 是「呼叫端」的身分。
 *   - 兩者並存，分別由 apiKey.ts 與本模組各自處理。
 *   - 當 DATA_AUTH_MODE=service-account（預設）時，本模組直接回傳 null，既有行為完全不變。
 *
 * scopeKey 取得優先序：
 *   1. IdP JWT 中 USER_JWT_SCOPE_CLAIM 對應的 claim（預設 "region"）
 *   2. 取不到 claim → scopeKey 為 null，polling 退為服務帳號或關閉 cache
 */

import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface UserScope {
  sub: string;       // IdP subject（使用者唯一識別）
  scopeKey: string;  // 對應 Superset 範圍帳號的 key（如 "中投一區"）
}

// JWKS 遠端驗證集合（首次使用時初始化，之後 jose 自動快取）
let remoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof createRemoteJWKSet> | null {
  if (!config.USER_JWT_JWKS_URI) return null;
  if (!remoteJwks) {
    remoteJwks = createRemoteJWKSet(new URL(config.USER_JWT_JWKS_URI));
  }
  return remoteJwks;
}

/**
 * 解析 X-User-Token header，回傳 UserScope 或 null。
 *
 * - DATA_AUTH_MODE=service-account：直接回 null（不解析）。
 * - USER_JWT_JWKS_URI 有設定：驗簽 + iss/aud，失敗則拋 401 等級錯誤。
 * - USER_JWT_JWKS_URI 未設定：僅 decode（開發用），不驗簽，記錄 warn。
 */
export async function resolveUserScope(request: Request): Promise<UserScope | null> {
  if (config.DATA_AUTH_MODE !== 'per-scope') return null;

  const raw = request.headers.get('X-User-Token');
  if (!raw) return null;

  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw.trim();
  if (!token) return null;

  const scopeClaim = config.USER_JWT_SCOPE_CLAIM;
  const jwks = getJwks();

  try {
    let payload: Record<string, unknown>;

    if (jwks) {
      // 完整驗證模式
      const verifyOpts: Parameters<typeof jwtVerify>[2] = {};
      if (config.USER_JWT_ISSUER) verifyOpts.issuer = config.USER_JWT_ISSUER;
      if (config.USER_JWT_AUDIENCE) verifyOpts.audience = config.USER_JWT_AUDIENCE;
      const { payload: p } = await jwtVerify(token, jwks, verifyOpts);
      payload = p as Record<string, unknown>;
    } else {
      // 開發用：僅 decode，不驗簽
      logger.warn('USER_JWT_JWKS_URI 未設定，跳過 JWT 簽章驗證（僅適用開發環境）');
      payload = decodeJwt(token) as Record<string, unknown>;
    }

    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    const scopeKey = typeof payload[scopeClaim] === 'string'
      ? (payload[scopeClaim] as string)
      : null;

    if (!scopeKey) {
      logger.warn({ sub, scopeClaim }, `X-User-Token 中找不到 "${scopeClaim}" claim，無法取得 scopeKey`);
      return null;
    }

    return { sub, scopeKey };
  } catch (err) {
    // JWT 格式錯誤或驗簽失敗：log 但不 expose token 內容
    logger.warn({ err: (err as Error).message }, 'X-User-Token 驗證失敗');
    return null;
  }
}
