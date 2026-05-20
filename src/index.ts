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

import { createServer } from 'node:http';
import { createYoga, createSchema } from 'graphql-yoga';
import { config } from './config.js';
import { logger } from './logger.js';
import { typeDefs } from './schema/typeDefs.js';
import { resolvers } from './resolvers/index.js';
import { createContext, type AppContext } from './auth/context.js';
import { resolveApiKeyName, isPublicEndpoint } from './auth/apiKey.js';
import { checkRateLimit, getRateLimitRemaining } from './auth/rateLimit.js';
import { printSchema } from 'graphql';

const schema = createSchema<AppContext>({ typeDefs, resolvers });

const yoga = createYoga<AppContext>({
  schema,
  context: createContext,
  plugins: [
    {
      onRequest: (params) => {
        const { request, fetchAPI } = params;
        const url = new URL(request.url);
        if (isPublicEndpoint(url)) return;

        // Auth check
        const clientName = resolveApiKeyName(request);
        if (config.API_KEYS && !clientName) {
          params.endResponse(
            new fetchAPI.Response(
              JSON.stringify({ error: 'Unauthorized', hint: 'Bearer <api-key> required' }),
              { status: 401, headers: { 'Content-Type': 'application/json' } },
            ),
          );
          return;
        }

        // Rate limit (skip when RPM=0 or no API key required)
        if (config.RATE_LIMIT_RPM > 0 && clientName) {
          const allowed = checkRateLimit(clientName, config.RATE_LIMIT_RPM);
          if (!allowed) {
            const remaining = getRateLimitRemaining(clientName, config.RATE_LIMIT_RPM);
            logger.warn({ clientName, remaining }, 'Rate limit exceeded');
            params.endResponse(
              new fetchAPI.Response(
                JSON.stringify({ error: 'Too Many Requests', retryAfterSeconds: 60 }),
                {
                  status: 429,
                  headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': '60',
                    'X-RateLimit-Limit': String(config.RATE_LIMIT_RPM),
                    'X-RateLimit-Remaining': String(remaining),
                  },
                },
              ),
            );
          }
        }
      },
    },
  ],
  logging: false,
});

const schemaSDL = printSchema(schema);

const server = createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.url === '/schema' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(schemaSDL);
    return;
  }
  void yoga(req, res);
});

server.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, env: config.NODE_ENV, superset: config.SUPERSET_URL },
    'Superset GraphQL Façade started',
  );
  logger.info(`GraphQL Playground: http://localhost:${config.PORT}/graphql`);
});

server.on('error', (err) => {
  logger.error({ err }, 'Server error');
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});
