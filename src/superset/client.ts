// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

import { config, parseScopeCredentials } from '../config.js';
import { logger } from '../logger.js';

const JWT_REFRESH_BEFORE_MS = 5 * 60 * 1000;
const JWT_TTL_MS = 60 * 60 * 1000;

interface LoginResponse {
  access_token: string;
}

// ── 服務帳號 singleton（用於 metadata / introspection 路徑）────────────────

class SupersetClient {
  private jwt: string | null = null;
  private jwtExpiresAt = 0;
  private loginPromise: Promise<string> | null = null;

  async getJwt(): Promise<string> {
    if (this.jwt && Date.now() < this.jwtExpiresAt - JWT_REFRESH_BEFORE_MS) {
      return this.jwt;
    }
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    return this.loginPromise;
  }

  private async login(): Promise<string> {
    logger.info({ username: config.SUPERSET_USERNAME }, 'Superset login');
    const res = await fetch(`${config.SUPERSET_URL}/api/v1/security/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: config.SUPERSET_USERNAME,
        password: config.SUPERSET_PASSWORD,
        provider: 'db',
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Superset login failed: HTTP ${res.status} ${body}`);
    }
    const data = (await res.json()) as LoginResponse;
    this.jwt = data.access_token;
    this.jwtExpiresAt = Date.now() + JWT_TTL_MS;
    logger.info('Superset JWT acquired');
    return this.jwt;
  }

  async get<T>(path: string): Promise<T> {
    const jwt = await this.getJwt();
    const res = await fetch(`${config.SUPERSET_URL}${path}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) throw new Error(`Superset GET ${path} failed: HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }

  async post<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const jwt = await this.getJwt();
    const res = await fetch(`${config.SUPERSET_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Superset POST ${path} failed: HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }
}

export const supersetClient = new SupersetClient();

// ── per-scope token store（用於 chart data 路徑）─────────────────────────────

interface ScopeTokenEntry {
  jwt: string;
  expiresAt: number;
  loginPromise: Promise<string> | null;
}

/**
 * ScopeTokenStore — 每個範圍一個 Superset session，各自獨立續期。
 * 憑證從 SCOPE_CREDENTIALS env 讀取，**不 log 密碼**。
 */
class ScopeTokenStore {
  private readonly entries = new Map<string, ScopeTokenEntry>();
  private readonly credentials = parseScopeCredentials(config.SCOPE_CREDENTIALS);

  async getJwt(scopeKey: string): Promise<string> {
    let entry = this.entries.get(scopeKey);

    if (entry?.jwt && Date.now() < entry.expiresAt - JWT_REFRESH_BEFORE_MS) {
      return entry.jwt;
    }

    if (!entry) {
      entry = { jwt: '', expiresAt: 0, loginPromise: null };
      this.entries.set(scopeKey, entry);
    }

    if (!entry.loginPromise) {
      entry.loginPromise = this.login(scopeKey).finally(() => {
        if (entry) entry.loginPromise = null;
      });
    }
    return entry.loginPromise;
  }

  private async login(scopeKey: string): Promise<string> {
    const cred = this.credentials.get(scopeKey);
    if (!cred) {
      throw new Error(
        `SCOPE_CREDENTIALS 中找不到 "${scopeKey}" 的憑證（DATA_AUTH_MODE=per-scope 需設定）`,
      );
    }

    // ⚠️ 只 log username，絕不 log password
    logger.info({ scopeKey, username: cred.username }, 'Superset scope login');
    const res = await fetch(`${config.SUPERSET_URL}/api/v1/security/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cred.username, password: cred.password, provider: 'db' }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Superset scope login [${scopeKey}] failed: HTTP ${res.status} ${body}`);
    }
    const data = (await res.json()) as LoginResponse;
    const entry = this.entries.get(scopeKey)!;
    entry.jwt = data.access_token;
    entry.expiresAt = Date.now() + JWT_TTL_MS;
    logger.info({ scopeKey }, 'Superset scope JWT acquired');
    return entry.jwt;
  }

  /** per-scope POST（主要用於 /api/v1/chart/data）*/
  async post<T>(
    scopeKey: string,
    path: string,
    body: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const jwt = await this.getJwt(scopeKey);
    const res = await fetch(`${config.SUPERSET_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Superset scope POST ${path} [${scopeKey}] failed: HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }

  /** per-scope GET */
  async get<T>(scopeKey: string, path: string): Promise<T> {
    const jwt = await this.getJwt(scopeKey);
    const res = await fetch(`${config.SUPERSET_URL}${path}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) throw new Error(`Superset scope GET ${path} [${scopeKey}] failed: HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }
}

export const scopeTokenStore = new ScopeTokenStore();
