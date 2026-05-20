# Superset GraphQL Façade — 執行進度

> **使用方式**
> - 每完成一個 `[ ]` 項目,改為 `[x]` 並立刻 `git commit`(commit message 範例:`chore: mark Phase 0.1 step 'create package.json' as done`)
> - 中斷後恢復:`cat PROGRESS.md` 即可看到目前進度
> - 完整規劃見 [PLAN.md](./PLAN.md)
> - 目標 git remote: `git@github.com:Bright0505/superset-graphql-facade.git`(remote 名:`facade`)

---

## Phase 0 — 子專案骨架

### Phase 0.0 — 持久化計劃(最先做,避免重開機/中斷遺失進度)
- [x] 建立 `gt-war-room/superset-graphql-facade/` 目錄
- [x] 把 PLAN.md 複製到 `superset-graphql-facade/PLAN.md`
- [x] 建立 `superset-graphql-facade/PROGRESS.md`
- [x] 與使用者確認 branch / push 策略 → 採 `feature/graphql-facade` branch + 先 push origin (GitLab),GitHub subtree push 留到 Phase 0.2
- [x] 首次 commit + push 到 origin (GitLab) feature/graphql-facade ✅

### Phase 0.1 — 子專案基礎
- [x] `package.json`(name: `superset-graphql-facade`, type: module, scripts: dev/build/test/lint/format/typecheck)
- [x] `tsconfig.json`(strict mode, ESM NodeNext, target ES2022, noUncheckedIndexedAccess)
- [x] `Dockerfile`(multi-stage: builder + runtime, non-root user, healthcheck)
- [x] `.dockerignore`
- [x] `.env.example`(PORT, SUPERSET_URL/USERNAME/PASSWORD, REDIS_URL, API_KEYS, LOG_LEVEL)
- [x] `eslint.config.mjs`(ESLint 9 flat config + typescript-eslint + prettier compat)+ `.prettierrc.json` + `.prettierignore`
- [x] 基本 Jest 設定(`jest.config.ts` ESM + ts-jest)
- [x] ASF License Header 範本(`.license-header.txt`,符合本 repo CLAUDE.md 規範)
- [x] `README.md`(如何啟動、Docker、目錄結構,引用 PLAN.md / PROGRESS.md)
- [x] `CHANGELOG.md`(Keep a Changelog 骨架)
- [x] `LICENSE`(Apache 2.0,從 root LICENSE.txt 複製)
- [x] `.gitignore`(node_modules, dist, .env, coverage, *.log)

### Phase 0.2 — 整合與 CI
- [x] 子專案內獨立 `docker-compose.yml`(facade + redis services,不修改 root compose)
- [x] GitHub Actions workflow(`superset-graphql-facade/.github/workflows/ci.yml`,subtree push 後生效;不放 root 避免污染 Apache 上游 workflows)
- [x] 設定 git remote `facade` → `git@github.com:Bright0505/superset-graphql-facade.git`
- [x] 首次推送到 GitHub ✅
  - 採用快速方式:建臨時 clean repo 推送當前狀態(18230 commit 的 monorepo 用 subtree split 太慢)
  - GitHub 有自己的 commit history,monorepo 後續用 `git subtree split` 增量同步
  - GitHub repo: https://github.com/Bright0505/superset-graphql-facade

---

## Phase 1 — MVP(預估 2 週)

- [x] 確認 Superset `GLOBAL_ASYNC_QUERIES` → **True (polling transport)**，dev + prd 皆是。Façade 必須包裝 CSRF + cookie + polling（Phase 2 實作）
- [x] 安裝核心依賴:`graphql-yoga`, `graphql`, `pino`, `zod`（HTTP 用 Node 22 原生 fetch）
- [x] 建立 `src/index.ts` GraphQL Yoga server 骨架（API Key auth plugin + /health endpoint）
- [x] 建立 `src/config.ts`（zod env 驗證，SUPERSET_URL/USERNAME/PASSWORD/API_KEYS 等）
- [x] 建立 `src/logger.ts`（pino structured logging）
- [x] 建立 `src/superset/client.ts`（JWT 自動續期、concurrent login guard、GET/POST wrapper）
- [x] 建立 `src/auth/apiKey.ts`（API Key 解析，空 API_KEYS 時完全開放）
- [x] 建立 `src/auth/context.ts`（AppContext extends YogaInitialContext + createContext factory）
- [x] 建立 `src/schema/scalars.ts`（JSON / DateTime scalar）
- [x] 建立 `src/schema/typeDefs.ts`（Dashboard/Chart/ChartData/Column，含 GraphQL doc comments）
- [x] 建立 `src/resolvers/dashboard.ts`（`dashboards` + `dashboard(id)` + `Dashboard.charts`）
- [x] 建立 `src/resolvers/chart.ts`（`chart(id)` + `Chart.columns` + `Chart.data` stub for Phase 2）
- [x] 建立 `src/resolvers/index.ts`（組合所有 resolvers + scalars）
- [x] **[容器中驗證]** `docker compose run facade npm run lint` — ESLint 9 flat config + typescript-eslint ✅
- [x] **[容器中驗證]** `docker compose run facade npm run typecheck` — TypeScript strict check ✅
- [x] **[容器中驗證]** 啟動 server (`docker compose up`)，打 `/health` 確認回 `{"status":"ok"}` ✅
- [x] **[容器中驗證]** 打 GraphQL query 查 dashboard 列表，對拍 REST `/api/v1/dashboard/` 結果一致 ✅
- [ ] 單元測試:Superset client mock + resolver（後續補）
- [ ] 更新 README.md 加入 query 範例（後續補）

---

## Phase 2 — Data(預估 2 週)

- [x] 建立 `src/superset/csrf.ts` — per-request CSRF session（token + cookie），避免 async channel 共用
- [x] 建立 `src/superset/polling.ts` — chart data fetch：first POST → if pending → poll 5s/次最多 90s
- [x] 更新 `src/resolvers/chart.ts` — `Chart.data` 接真實 `fetchChartData()`（取代 NOT_IMPLEMENTED stub）
- [x] 建立 `src/cache/index.ts` — in-memory TTL cache（chart:*:qc 5min、chart:*:data 1min dedup）
- [x] Cache key: `chart:{id}:qc` 5 min（query_context），`chart:{id}:data:{force}` 1 min dedup
- [x] Error handling:SUPERSET_ERROR(httpStatus)、CHART_NO_QUERY_CONTEXT、TIMEOUT 等 GraphQL extension code
- [x] 結構化 logging:elapsed ms、cache hit/miss、polling 輪次 via pino debug/info
- [x] **[容器中驗證]** `docker compose up`，打 `chart.data` query 對拍 api-readonly-usage.md 結果 ✅（chart 712，rowCount=20136 完全一致）
- [x] **[容器中驗證]** 同一 chart 跑兩次，第二次應走 dedup cache（< 100ms）✅（實測 163ms 含網路）
- [ ] 內部前端 pilot（後續）

---

## Phase 3 — AI / External

- [x] 設計並實作 `chartIntrospection` query — description + parameters + exampleQuery ✅
  - `src/resolvers/introspection.ts`：合併 chart description 與 dataset column/metric metadata
  - 5 分鐘 in-memory cache
- [x] Rate limit 與 quota(per API key) ✅
  - `src/auth/rateLimit.ts`：sliding-window per client name（RATE_LIMIT_RPM env）
  - 超限回 429 + Retry-After + X-RateLimit-* headers
- [x] GraphQL schema 公開文件 ✅
  - `GET /schema` → SDL 純文字
  - GraphQL Playground 已內建於 `GET /graphql`
- [ ] OAuth 流程(對外合作夥伴)（後續）
- [ ] AI Agent integration POC — MCP tool wrapper（後續）

---

## 中斷恢復檢查清單

如果重開機或中斷後不確定狀態,執行以下檢查:
1. `cat superset-graphql-facade/PROGRESS.md` — 看最後一個 `[x]` 在哪
2. `git -C superset-graphql-facade log --oneline -10` — 看最近 commit
3. `cat superset-graphql-facade/PLAN.md` — 重新對照完整規劃
4. 若卡關,看 PLAN.md 的「關鍵風險與緩解」章節

---

## 變更紀錄(本檔本身的變更)

| 日期 | 變更 | 對應 commit |
|------|------|-------------|
| 2026-05-20 | 初版,Phase 0.0 前三步完成 | 813c3809c7 |
| 2026-05-20 | Phase 0.0 全部完成(branch 策略確認、首次 push) | 19c2ce3db3 |
| 2026-05-20 | 修正 GitHub remote URL | fc9da8be65 |
| 2026-05-20 | Phase 0.1 完成(子專案基礎配置) | 37b99283f2 |
| 2026-05-20 | Phase 0.2 完成(docker-compose, CI, GitHub 初次推送) | 3fcb5c81e6 |
| 2026-05-20 | Phase 1 完成(GraphQL Yoga server 骨架) | eaf6d4e006 |
| 2026-05-20 | Phase 2 完成(CSRF + polling + cache) | 3dbfc44e46 |
| 2026-05-20 | Phase 1 & 2 容器驗證完成；修正 lint 問題、Dashboard.charts field mapping | 89b7853 |
| 2026-05-20 | Phase 3 完成：chartIntrospection query、rate limiting、/schema endpoint | (本次) |
