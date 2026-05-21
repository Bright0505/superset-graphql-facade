# Changelog

All notable changes to `superset-graphql-facade` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Phase 0.0: 子專案目錄與 PLAN.md / PROGRESS.md 持久化計劃
- Phase 0.1: package.json, tsconfig.json, Dockerfile, ESLint/Prettier, Jest 配置
- Phase 0.1: README.md, LICENSE (Apache-2.0), .gitignore, .env.example
- Phase 0.2: docker-compose.yml（facade + redis）、GitHub Actions CI workflow
- Phase 1: GraphQL Yoga server 骨架（`src/index.ts`）、API Key auth、`/health` endpoint
- Phase 1: Superset REST client（JWT 自動續期 + concurrent login guard）
- Phase 1: GraphQL schema（Dashboard / Chart / Column / ChartData）與 resolvers
- Phase 1: JSON / DateTime scalar、pino structured logging、zod env 驗證
- Phase 2: 每請求獨立 CSRF session（`src/superset/csrf.ts`），避免 async-channel 衝突
- Phase 2: chart data polling 流程（`src/superset/polling.ts`）：initial POST → 5s/次最多 90s
- Phase 2: in-memory TTL cache（`src/cache/index.ts`）：query_context 5min、data dedup 1min
- Phase 2: `Chart.data` resolver 接真實 fetchChartData，帶結構化 error code

### Changed
- 重構：將 `SupersetDatasetColumn`、`SupersetDatasetMetric`、`SupersetDatasetDetail` 等重複型別定義合併至 `src/superset/types.ts`，chart.ts 與 introspection.ts 改從共用型別 import
- 新增 `src/resolvers/chart.test.ts` 與 `src/resolvers/introspection.test.ts`，涵蓋 mapColumn/mapMetric/buildDescription/buildParameters 等 pure function 的單元測試
- 新增 docker-compose `test` service（profile: test），可於容器內執行 `docker compose --profile test run --rm test` 跑測試
