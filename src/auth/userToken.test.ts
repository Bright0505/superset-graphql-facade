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
 * userToken.test.ts — resolveUserScope 的單元測試。
 *
 * 測試策略：
 *  - config 以 jest.mock 隔離，不需要真實 .env。
 *  - jose 以 jest.mock 攔截，避免 JWKS 網路呼叫。
 *  - Request 用 Node.js 內建 Request 建構（Jest + ts-jest 環境支援）。
 */

// ─── Mock: config ──────────────────────────────────────────────────────────

const mockConfig = {
  DATA_AUTH_MODE: 'per-scope' as 'service-account' | 'per-scope',
  USER_JWT_JWKS_URI: undefined as string | undefined,
  USER_JWT_ISSUER: undefined as string | undefined,
  USER_JWT_AUDIENCE: undefined as string | undefined,
  USER_JWT_SCOPE_CLAIM: 'region',
};

jest.mock('../config.js', () => ({ config: mockConfig }));

// ─── Mock: logger ──────────────────────────────────────────────────────────

jest.mock('../logger.js', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

// ─── Mock: jose ───────────────────────────────────────────────────────────

const mockDecodeJwt = jest.fn();
const mockJwtVerify = jest.fn();
const mockCreateRemoteJWKSet = jest.fn();

jest.mock('jose', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decodeJwt: (...args: any[]) => mockDecodeJwt(...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jwtVerify: (...args: any[]) => mockJwtVerify(...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createRemoteJWKSet: (...args: any[]) => mockCreateRemoteJWKSet(...args),
}));

// ─── 重置模組間共享的 remoteJwks singleton ─────────────────────────────────

beforeEach(() => {
  jest.resetModules();
  mockDecodeJwt.mockReset();
  mockJwtVerify.mockReset();
  mockCreateRemoteJWKSet.mockReset().mockReturnValue('mock-jwks');
  mockConfig.DATA_AUTH_MODE = 'per-scope';
  mockConfig.USER_JWT_JWKS_URI = undefined;
  mockConfig.USER_JWT_ISSUER = undefined;
  mockConfig.USER_JWT_AUDIENCE = undefined;
  mockConfig.USER_JWT_SCOPE_CLAIM = 'region';
});

// ─── Helper ───────────────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/', { headers });
}

// 動態 import 讓每個 test 拿到重置後的模組狀態（因有 remoteJwks singleton）
async function getResolveUserScope() {
  const mod = await import('./userToken.js');
  return mod.resolveUserScope;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('resolveUserScope', () => {
  test('DATA_AUTH_MODE=service-account 時直接回 null，不解析 token', async () => {
    mockConfig.DATA_AUTH_MODE = 'service-account';
    const resolveUserScope = await getResolveUserScope();
    const req = makeRequest({ 'X-User-Token': 'some-token' });
    expect(await resolveUserScope(req)).toBeNull();
    expect(mockDecodeJwt).not.toHaveBeenCalled();
  });

  test('缺少 X-User-Token header 時回 null', async () => {
    const resolveUserScope = await getResolveUserScope();
    expect(await resolveUserScope(makeRequest())).toBeNull();
  });

  test('X-User-Token 僅含空白時回 null', async () => {
    const resolveUserScope = await getResolveUserScope();
    expect(await resolveUserScope(makeRequest({ 'X-User-Token': '  ' }))).toBeNull();
  });

  test('無 JWKS URI：decode 模式，成功萃取 sub + scopeKey', async () => {
    mockDecodeJwt.mockReturnValue({ sub: 'user-123', region: '中投一區' });
    const resolveUserScope = await getResolveUserScope();
    const req = makeRequest({ 'X-User-Token': 'fake.jwt.token' });
    const result = await resolveUserScope(req);
    expect(result).toEqual({ sub: 'user-123', scopeKey: '中投一區' });
    expect(mockDecodeJwt).toHaveBeenCalledWith('fake.jwt.token');
  });

  test('無 JWKS URI：decode 模式，支援 Bearer 前綴', async () => {
    mockDecodeJwt.mockReturnValue({ sub: 'user-456', region: '商場一部' });
    const resolveUserScope = await getResolveUserScope();
    const req = makeRequest({ 'X-User-Token': 'Bearer fake.jwt.token' });
    const result = await resolveUserScope(req);
    expect(result).toEqual({ sub: 'user-456', scopeKey: '商場一部' });
    expect(mockDecodeJwt).toHaveBeenCalledWith('fake.jwt.token');
  });

  test('無 JWKS URI：scope claim 不存在時回 null', async () => {
    mockDecodeJwt.mockReturnValue({ sub: 'user-789' }); // 無 region claim
    const resolveUserScope = await getResolveUserScope();
    const result = await resolveUserScope(makeRequest({ 'X-User-Token': 'fake.jwt' }));
    expect(result).toBeNull();
  });

  test('無 JWKS URI：自訂 scope claim 欄位', async () => {
    mockConfig.USER_JWT_SCOPE_CLAIM = 'department';
    mockDecodeJwt.mockReturnValue({ sub: 'user-abc', department: '北區' });
    const resolveUserScope = await getResolveUserScope();
    const result = await resolveUserScope(makeRequest({ 'X-User-Token': 'fake.jwt' }));
    expect(result).toEqual({ sub: 'user-abc', scopeKey: '北區' });
  });

  test('有 JWKS URI：呼叫 jwtVerify 並傳入 issuer/audience', async () => {
    mockConfig.USER_JWT_JWKS_URI = 'https://idp.example.com/.well-known/jwks.json';
    mockConfig.USER_JWT_ISSUER = 'https://idp.example.com';
    mockConfig.USER_JWT_AUDIENCE = 'facade-api';
    mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-x', region: '南區' } });

    const resolveUserScope = await getResolveUserScope();
    const result = await resolveUserScope(makeRequest({ 'X-User-Token': 'signed.jwt' }));
    expect(result).toEqual({ sub: 'user-x', scopeKey: '南區' });
    expect(mockJwtVerify).toHaveBeenCalledWith(
      'signed.jwt',
      'mock-jwks',
      expect.objectContaining({ issuer: 'https://idp.example.com', audience: 'facade-api' }),
    );
  });

  test('jwtVerify 失敗（簽章錯誤）：回 null，不拋例外', async () => {
    mockConfig.USER_JWT_JWKS_URI = 'https://idp.example.com/.well-known/jwks.json';
    mockJwtVerify.mockRejectedValue(new Error('signature verification failed'));

    const resolveUserScope = await getResolveUserScope();
    const result = await resolveUserScope(makeRequest({ 'X-User-Token': 'bad.jwt' }));
    expect(result).toBeNull();
  });

  test('decode 拋出例外時：回 null，不拋例外', async () => {
    mockDecodeJwt.mockImplementation(() => { throw new Error('invalid jwt format'); });
    const resolveUserScope = await getResolveUserScope();
    const result = await resolveUserScope(makeRequest({ 'X-User-Token': 'malformed' }));
    expect(result).toBeNull();
  });
});
