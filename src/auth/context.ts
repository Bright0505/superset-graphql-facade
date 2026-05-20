// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0

import type { YogaInitialContext } from 'graphql-yoga';
import { resolveApiKeyName, isPublicEndpoint } from './apiKey.js';

export interface AppContext extends YogaInitialContext {
  clientName: string | null;
}

export function createContext(initial: YogaInitialContext): AppContext {
  const url = new URL(initial.request.url);
  const clientName = isPublicEndpoint(url)
    ? 'anonymous'
    : resolveApiKeyName(initial.request);
  return { ...initial, clientName };
}
