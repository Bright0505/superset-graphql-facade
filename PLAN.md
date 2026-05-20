# Superset GraphQL Façade — 規劃文件

## Context

### 目前狀況
- 內部已用 Apache Superset (`rep.greattree.com.tw`) 建立 dashboard / chart / dataset，作為報表 source of truth。
- 提供 `api-readonly` 帳號讓外部呼叫，使用規範見 `docs/superset-api/api-readonly-usage.md`。
- 取得圖表數值需 **JWT + CSRF + cookie + async polling** 的多步驟流程（見 `api-readonly-usage.md` Step 1–6），整合到前端 / 第三方系統成本高。

### 想解決的痛點
讓組織內形成清楚的分工：
1. **報表開發者** 在 Superset 專心建模、定義 chart query_context。
2. **前端 / 應用開發者** 只面對乾淨的 GraphQL，不用碰 CSRF/cookie/polling。
3. **未來** 同一層可以給 AI agent（schema-driven tool use）和對外合作夥伴 API 重用。

### 期望結果
**Superset 新增 dashboard 或 chart 後，Façade 不需要任何程式碼異動，GraphQL client 直接就能查到。**

### 執行原則（避免中斷遺失進度）
1. **計劃檔案化**：本 PLAN.md 在 Phase 0.0 立刻複製到 `superset-graphql-facade/PLAN.md`，即使本 ~/.claude/plans 檔案遺失也能恢復。
2. **進度檔案化**：所有步驟以 `superset-graphql-facade/PROGRESS.md` 的 checklist 為單一真相,完成一項就改 `[x]` 並 git commit。重開機/中斷後只需 `cat PROGRESS.md` 就能接續。
3. **頻繁推送**：每完成一個 Phase 子階段就 push 一次到 GitHub remote,讓進度多一份遠端備份。
4. **不依賴對話記憶**：不假設 LLM session 連續性,所有決策、待辦、已完成項都寫進 PROGRESS.md 與 PLAN.md。

---

## 為什麼不用 CubeJS

雖然 CubeJS 是常被提到的 BI Layer，但它與本案需求方向相反：

| 維度 | CubeJS | 本案需求 |
|------|--------|----------|
| Source of truth | CubeJS 自己的 `.js` schema | Superset 已建好的 dashboard/chart |
| 與 Superset 關係 | Superset 把 CubeJS 當虛擬資料庫連線 | Façade 消費 Superset 的成品 |
| 報表開發流程 | 在 CubeJS 重新建模 | 沿用 Superset 既有 |
| 對 query_context 的態度 | 完全忽略 | 重用 |

結論：CubeJS 路線會讓報表開發者**雙倍工作**（Superset + CubeJS 都建一遍），違反「Superset 為 source of truth」原則。**排除**。

同樣排除：Hasura（主打 Postgres → GraphQL，不適合 REST + async polling）、GraphQL Mesh（OpenAPI auto-gen 看似省力，但 async polling、auth 轉換、JSON scalar 處理都要寫 plugin，反而比自寫服務複雜）。

---

## 推薦方案：自建 GraphQL Façade（Node.js + GraphQL Yoga）

### 技術選型理由
- **Node.js + TypeScript**：前端團隊熟悉，GraphQL 工具鏈最成熟。
- **GraphQL Yoga**（或 Apollo Server）：輕量、middleware 豐富、HTTP/WebSocket 都支援。
- 不採 Python：雖能重用 superset 的 marshmallow schema，但本案不需要重建模，這個優勢不成立。

### 架構
```
[前端 React/Vue]  [AI Agent (LLM tool use)]  [合作夥伴系統]
                ↘            ↓            ↙
              ┌─────────────────────────────┐
              │     GraphQL Façade           │
              │  ┌────────────────────────┐  │
              │  │ Auth: API Key / JWT    │  │
              │  │   ↓                    │  │
              │  │ Superset Service Acct  │  │
              │  ├────────────────────────┤  │
              │  │ Resolver:              │  │
              │  │  - Dashboard / Chart   │  │
              │  │  - ChartData (async    │  │
              │  │    polling 內封)       │  │
              │  ├────────────────────────┤  │
              │  │ Cache (Redis)          │  │
              │  └────────────────────────┘  │
              └────────────┬────────────────┘
                           │ JWT + REST
                ┌──────────▼──────────┐
                │      Superset       │
                └──────────┬──────────┘
                ┌──────────▼──────────┐
                │   Data Warehouse    │
                └─────────────────────┘
```

---

## GraphQL Schema 設計（Generic — 新增報表不用改）

關鍵設計：**Dashboard / Chart 是固定的 entity，數值欄位用 `JSON` scalar 回傳**。這樣 Superset 新增任何 chart，client 不用改 schema 就能查。

```graphql
scalar JSON
scalar DateTime

type Dashboard {
  id: ID!
  title: String!
  slug: String
  published: Boolean!
  charts: [Chart!]!
}

type Chart {
  id: ID!
  name: String!
  vizType: String!
  datasourceId: ID
  description: String
  # 欄位 metadata，給 AI / client 知道結構
  columns: [Column!]!
  # 取實際數值，async polling 在內部處理
  data(force: Boolean = false): ChartData!
}

type Column {
  name: String!
  label: String
  type: String           # numeric / string / datetime
  isMetric: Boolean!
}

type ChartData {
  rows: [JSON!]!         # 動態欄位，使用 JSON scalar
  columnNames: [String!]!
  rowCount: Int!
  cached: Boolean!
  cachedAt: DateTime
  query: String          # 實際執行的 SQL
}

type Query {
  dashboards(search: String, page: Int = 0, pageSize: Int = 25): [Dashboard!]!
  dashboard(id: ID!): Dashboard
  chart(id: ID!): Chart
}
```

**為什麼 `rows: [JSON!]!` 是必要妥協**：要保留「新增 chart 不用改 schema」，欄位就必須是動態的。Trade-off 是 client 拿到 JSON 後要自己解析欄位 — 但 `columnNames` 和 `columns` metadata 可以引導。對 AI agent 場景，也可以額外加 schema introspection（章節在下方）。

---

## 關鍵實作項目

### 1. 先確認 Superset 的 async 設定（Façade 複雜度的關鍵分歧）

**這是動工前第一步**。指令：
```bash
# 進 Superset container / server
grep -r "GLOBAL_ASYNC_QUERIES" superset_config.py /app/pythonpath/
# 或在 Superset shell 中
python -c "from superset import app; print(app.config.get('GLOBAL_ASYNC_QUERIES'))"
```

| 結果 | Façade 複雜度 |
|------|--------------|
| `False` / 未設定 | **最簡單** — chart/data 同步回應，Façade 只需 JWT + REST 呼叫 |
| `True` | **較複雜** — 需處理 CSRF + cookie + channel + polling，或改用 Redis Stream subscription |

如果是 `True` 且可接受改為 `False`，**強烈建議改為同步模式**（或為 Façade 開一個專屬 service account 走同步路徑），會省下 60% 以上實作量。

### 2. Auth 簡化
- 對外：API Key（給合作夥伴）/ 內部 JWT（給內網前端）/ OAuth（給對外 SaaS）
- 內部：Façade 用一個固定 `api-readonly` service account 登入 Superset，全程重用 JWT（提前 5 分鐘刷新）
- **不要把 Superset JWT 透傳給 client**，避免 client 拿到 Superset 直連權限

### 3. Schema 動態同步
GraphQL schema 本身固定（Dashboard/Chart/Column 三個 entity），**動態的是內容**：
- Resolver 呼叫 `GET /api/v1/dashboard/` 即時取得清單
- 不快取 schema，但快取 metadata（dashboard / chart 列表 5 分鐘）
- 結論：**Superset 新增報表，Façade 完全不用改 code、不用重啟**

### 4. Cache 層（Redis）
| Cache key | TTL | 目的 |
|-----------|-----|------|
| `dashboard:list:{page}` | 5 min | 減少對 Superset metadata 端點壓力 |
| `chart:{id}:meta` | 5 min | 同上 |
| `chart:{id}:data:{hash}` | 1 min | 避免多個 client 同時打同一 chart |
| `superset:jwt` | 50 min | 共用 Superset login JWT |

**注意**：Superset 本身對 chart/data 已有 6 小時 cache（`cache_timeout: 21600`），Façade 端 cache 只是去重，TTL 不用長。

### 5. AI Agent 友善的 introspection（Phase 2 再做）
為 LLM tool use 加一個額外 query：
```graphql
type Query {
  chartIntrospection(id: ID!): ChartIntrospection!
}
type ChartIntrospection {
  description: String!         # LLM 可讀的描述
  parameters: [Parameter!]!    # 可填的 filter / time range
  exampleQuery: String!        # GraphQL query 範例
}
```
資料來源：Superset chart 的 `description` 欄位 + dataset metric / column metadata。

### 6. 不要實作的功能（避免 scope creep）
- ❌ 寫入 / 改 dashboard（保持唯讀，符合 `api-readonly` 角色）
- ❌ 自定義 metric / 跨 chart join（這是 semantic layer 的工作，需求變了再考慮 CubeJS）
- ❌ 自己快取查詢結果超過 5 分鐘（讓 Superset 自己的快取做這事）

---

## 子專案結構

### 定位
- **獨立子專案**：放在 `gt-war-room/` 根目錄下，與 `superset-websocket/`、`superset-embedded-sdk/` 並列，符合既有 `superset-*/` 命名慣例。
- **獨立維護單位**：自己的 `package.json`、`tsconfig.json`、`Dockerfile`、`README.md`、`CHANGELOG.md`、版本號、CI pipeline、Docker image。
- **可獨立部署**：不依賴 Superset 同一個 process / Python runtime,純 Node.js HTTP 服務,可獨立 scale。
- **未來可拔出**：整個 `superset-graphql-facade/` 目錄可直接 `git filter-repo` 切到獨立 repo,無 monorepo 黏著。

### Git remote
- **目標 repo**：`git@github.com:Bright0505/superset-graphql-facade.git`
- **初期作法**：在 `gt-war-room` monorepo 內開發,使用 `git subtree push`(或 `git filter-repo`)推送 `superset-graphql-facade/` 子目錄到上述 GitHub repo。
- **指令範例**(Phase 0 完成後執行):
  ```bash
  # 一次性設定 remote
  git remote add facade git@github.com:Bright0505/superset-graphql-facade.git
  # 推送子目錄
  git subtree push --prefix=superset-graphql-facade facade main
  ```

### 目錄結構
```
gt-war-room/
├── superset/                       # ← Superset 本體（不動）
├── superset-frontend/              # ← 既有
├── superset-websocket/             # ← 既有，命名慣例參考
├── superset-graphql-facade/        # ← 新建子專案
│   ├── PLAN.md                     # ← 完整規劃複本（本檔複製過去），中斷後可從此恢復
│   ├── PROGRESS.md                 # ← 執行進度 checklist，每完成一個 task 立刻勾選並 commit
│   ├── src/
│   │   ├── index.ts                # entry point（GraphQL Yoga server）
│   │   ├── schema/
│   │   │   ├── typeDefs.ts         # GraphQL SDL
│   │   │   └── scalars.ts          # JSON / DateTime scalar
│   │   ├── resolvers/
│   │   │   ├── dashboard.ts
│   │   │   ├── chart.ts
│   │   │   └── chartData.ts        # async polling 邏輯封裝
│   │   ├── superset/
│   │   │   ├── client.ts           # 共用的 Superset REST client（JWT 管理）
│   │   │   ├── csrf.ts             # CSRF + cookie + channel 管理
│   │   │   └── polling.ts          # async polling 流程
│   │   ├── auth/
│   │   │   ├── apiKey.ts
│   │   │   └── context.ts          # GraphQL context (auth payload)
│   │   ├── cache/
│   │   │   └── redis.ts
│   │   ├── config.ts               # env-based config (SUPERSET_URL, etc.)
│   │   └── logger.ts
│   ├── test/
│   │   ├── unit/
│   │   └── integration/            # 對拍 Superset 真實環境
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── .env.example                # SUPERSET_URL, SUPERSET_USER, REDIS_URL, API_KEYS...
│   ├── .eslintrc.json
│   ├── .prettierrc
│   ├── tsconfig.json
│   ├── package.json                # 獨立的 dependencies
│   ├── package-lock.json
│   ├── README.md                   # 子專案文件（如何啟動、如何發版、架構說明）
│   ├── CHANGELOG.md
│   └── LICENSE                     # ASF License Header（符合本 repo 規範）
├── docker-compose.yml              # ← 新增 graphql-facade service 條目（選用）
└── ...
```

### 與既有系統的整合點（最少）
- **docker-compose**：在 `docker-compose.yml` / `docker-compose-non-dev.yml` 新增一個 `superset-graphql-facade` service 條目（環境變數指向 superset、redis），方便本地起整套。**不修改 Superset 本體任何檔案**。
- **CI**：在 `.github/workflows/` 新增 `superset-graphql-facade.yml`，只在 `superset-graphql-facade/**` 路徑變動時觸發（與 Superset CI 完全隔離）。
- **不共用**：不共用 `superset-frontend/` 的 node_modules、不共用 root pyproject.toml、不寫進 root Makefile 的主流程。

### 不會修改的 Superset 端檔案（只是讀懂）
- `superset/charts/data/api.py:199-247` — chart/data POST 端點規格
- `superset/charts/schemas.py` — ChartDataQueryContextSchema 等型別定義
- `superset/async_events/async_query_manager.py:169-207` — async channel 機制

**參考的 Superset 端檔案**（不會修改，只是讀懂）：
- `superset/charts/data/api.py:199-247` — chart/data POST 端點規格
- `superset/charts/schemas.py` — ChartDataQueryContextSchema 等型別定義
- `superset/async_events/async_query_manager.py:169-207` — async channel 機制

---

## 分階段實作建議

### Phase 0 — 子專案骨架（0.5 週）
**Phase 0.0 — 持久化計劃（最先做，避免重開機/中斷遺失進度）**
- [ ] 建立 `gt-war-room/superset-graphql-facade/` 目錄
- [ ] 把本檔（PLAN.md）複製到 `superset-graphql-facade/PLAN.md`
- [ ] 建立 `superset-graphql-facade/PROGRESS.md`，內容為「分階段實作建議」整段的 checklist 版本（每個 `[ ]` 完成時就改為 `[x]` 並 git commit，commit message 例：`chore: mark Phase 0.1 step 'create package.json' as done`）
- [ ] 首次 commit + push（即使只有 PLAN.md / PROGRESS.md，先讓進度有遠端備份）

**Phase 0.1 — 子專案基礎**
- [ ] `package.json` / `tsconfig.json` / `Dockerfile` / `.env.example`
- [ ] ESLint + Prettier + 基本 Jest 設定
- [ ] ASF License Header（符合本 repo 規範，見 CLAUDE.md）
- [ ] README.md（如何啟動、如何發版、簡略架構說明，引用 PLAN.md）

**Phase 0.2 — 整合與 CI**
- [ ] 在 `docker-compose.yml` 加入 service 條目（指向 superset & redis）
- [ ] GitHub Actions workflow（path filter 只觸發本子專案）
- [ ] 設定 git remote `facade` 指向 `git@github.com:Bright0505/superset-graphql-facade.git`
- [ ] 第一次 `git subtree push --prefix=superset-graphql-facade facade main` 確認推送流程可運作

### Phase 1 — MVP（2 週）
- [ ] 確認 Superset `GLOBAL_ASYNC_QUERIES` 設定，決定是否切同步模式
- [ ] Node.js + GraphQL Yoga 專案骨架（在 Phase 0 結構上加 code）
- [ ] Superset client（JWT 自動續期）
- [ ] `dashboard` / `chart` query（不含 data resolver）
- [ ] API Key auth

### Phase 2 — Data（2 週）
- [ ] `chart.data` resolver（同步或 async polling 視 Phase 1 決策）
- [ ] Redis cache 層
- [ ] Error handling / structured logging
- [ ] 一個內部前端 pilot（挑一個現有報表轉用 GraphQL）

### Phase 3 — AI/External（後續）
- [ ] `chartIntrospection` query
- [ ] OAuth / partner API key 分流
- [ ] Rate limit 與 quota

---

## 驗證方式

### 開發階段
```bash
# 1. 啟動 facade
npm run dev

# 2. GraphQL playground 開啟 http://localhost:4000/graphql
# 3. 跑下列 query 驗證
```

```graphql
# 列出 dashboard
query { dashboards(pageSize: 5) { id title } }

# 取得 chart 結構
query { chart(id: "1141") { name vizType columns { name type isMetric } } }

# 取得 chart 數值（同 api-readonly-usage.md 的 Step 1–6 應產出相同 row count）
query { chart(id: "1141") { data { rowCount columnNames rows } } }
```

### 對拍驗證
跑同一個 chart：
- A. 用 `docs/superset-api/api-readonly-usage.md` 完整流程拿一份結果
- B. 用 Façade GraphQL 拿一份結果
- 比對 `rowCount` 與 `rows`（順序、欄位完全一致）

### Pilot 驗證
挑一個內部前端頁面（建議跟報表開發者一起選一個近期有改動的 dashboard），改用 GraphQL：
- ✅ 前端碼簡化（去掉 CSRF/polling）
- ✅ Superset 新增 chart 後，前端不用改 schema、不用重啟 Façade
- ✅ Response 時間相當（cache hit 應 < 100ms）

---

## 關鍵風險與緩解

| 風險 | 緩解 |
|------|------|
| Superset async cookie 機制與 Façade service account 模型衝突 | Phase 1 第一步確認 `GLOBAL_ASYNC_QUERIES`，必要時請 Superset admin 為 Façade 帳號關掉 |
| `query_context` schema 隨 Superset 版本變動 | Façade 只解析少數固定欄位（rowCount/data/colnames），其他透傳；升級 Superset 前跑對拍 |
| client 拿到 `rows: JSON` 後解析錯誤 | 在 schema 中強制 `columnNames` 必填，並提供 `columns` metadata；文件給範例 |
| 取代 Superset 自己 cache 的傾向 | 嚴守「Façade cache TTL 短、Superset 6 小時快取為主」原則 |
