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
import { logger } from '../logger.js';

const JWT_REFRESH_BEFORE_MS = 5 * 60 * 1000; // 過期前 5 分鐘刷新
const JWT_TTL_MS = 60 * 60 * 1000;           // Superset 預設 1 小時

interface LoginResponse {
  access_token: string;
}

class SupersetClient {
  private jwt: string | null = null;
  private jwtExpiresAt = 0;
  private loginPromise: Promise<string> | null = null;

  async getJwt(): Promise<string> {
    if (this.jwt && Date.now() < this.jwtExpiresAt - JWT_REFRESH_BEFORE_MS) {
      return this.jwt;
    }
    // 防止多個 concurrent 請求同時 login
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
    const url = `${config.SUPERSET_URL}${path}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) {
      throw new Error(`Superset GET ${path} failed: HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async post<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const jwt = await this.getJwt();
    const url = `${config.SUPERSET_URL}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Superset POST ${path} failed: HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }
}

export const supersetClient = new SupersetClient();
