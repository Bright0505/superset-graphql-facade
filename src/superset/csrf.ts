// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

import { config } from '../config.js';

export interface CsrfSession {
  csrfToken: string;
  cookieHeader: string;
}

interface CsrfTokenResponse {
  result: string;
}

/**
 * 取得一次性 CSRF session（token + cookies）。
 *
 * 每個 chart.data 請求必須獨立取得自己的 CSRF session，避免多個並發請求
 * 共用同一個 async-token cookie（channel），導致 Superset 找不到對應的快取 job。
 *
 * 警告：取得 session 後，在整個 polling 流程中不可再次呼叫此函式，
 * 否則 async-token cookie 會更新，breaking the polling channel。
 */
export async function createCsrfSession(jwt: string): Promise<CsrfSession> {
  const res = await fetch(`${config.SUPERSET_URL}/api/v1/security/csrf_token/`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!res.ok) {
    throw new Error(`CSRF token fetch failed: HTTP ${res.status}`);
  }

  // Node 22 undici Headers 支援 getSetCookie()，回傳每個 Set-Cookie header 為獨立字串
  const setCookies = (
    res.headers as unknown as { getSetCookie: () => string[] }
  ).getSetCookie();

  // 只取 name=value 部分（去掉 Path; HttpOnly; Secure 等屬性）
  const cookieHeader = setCookies
    .map((h) => h.split(';')[0]!.trim())
    .join('; ');

  const data = (await res.json()) as CsrfTokenResponse;

  return { csrfToken: data.result, cookieHeader };
}
