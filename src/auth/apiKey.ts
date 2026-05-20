// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

import { config, parseApiKeys } from '../config.js';

const apiKeyMap = parseApiKeys(config.API_KEYS);

export function resolveApiKeyName(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const key = authHeader.slice(7).trim();
  return apiKeyMap.get(key) ?? null;
}

export function isPublicEndpoint(url: URL): boolean {
  return url.pathname === '/health';
}
