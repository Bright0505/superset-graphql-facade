# Superset GraphQL Façade

Apache Superset REST API 之上的 GraphQL Façade 層,讓內部前端 / AI agent / 合作夥伴系統可以用 GraphQL 查詢 Superset 既有 dashboard / chart 的數值,而不需要直接處理 Superset 的 JWT + CSRF + cookie + async polling。

> **核心設計原則:Superset 為 source of truth**
> Façade 不重新建模、不取代 Superset。報表開發者照常在 Superset 建 dashboard,Façade 自動暴露為 GraphQL。新增報表 → Façade **不需異動**。

完整規劃文件:**[PLAN.md](./PLAN.md)**
執行進度:**[PROGRESS.md](./PROGRESS.md)**

---

## 架構簡述

```
[前端 / AI Agent / 合作夥伴]
         ↓ GraphQL
[Superset GraphQL Façade]   ← 本子專案
         ↓ JWT + REST
[Apache Superset]
         ↓
[Data Warehouse]
```

技術選型:**Node.js 22 + TypeScript + GraphQL Yoga**(理由見 PLAN.md「為什麼不用 CubeJS / GraphQL Mesh」章節)。

---

## 開發

### 前置需求
- Node.js >= 22
- npm
- 可存取的 Superset 環境(`rep-lab.greattree.com.tw` 或 `rep.greattree.com.tw`)
- (Phase 2 起需要)Redis

### 啟動
```bash
# 1. 複製環境變數範本
cp .env.example .env
# 編輯 .env,填入 SUPERSET_PASSWORD 等

# 2. 安裝依賴
npm install

# 3. 啟動 dev server(熱重載)
npm run dev
```

啟動後 GraphQL Playground 在 `http://localhost:4000/graphql`(預設,可由 `PORT` 環境變數調整)。

### 常用指令
| 指令 | 用途 |
|------|------|
| `npm run dev` | 啟動 dev server(tsx watch) |
| `npm run build` | TypeScript 編譯到 `dist/` |
| `npm start` | 執行 build 後的產物 |
| `npm test` | 執行 Jest 單元測試 |
| `npm run lint` | ESLint 檢查 |
| `npm run format` | Prettier 格式化 |
| `npm run typecheck` | TypeScript 型別檢查(不產出檔案) |

### Docker
```bash
# Build
docker build -t superset-graphql-facade .

# Run
docker run --rm -p 4000:4000 --env-file .env superset-graphql-facade
```

或用子專案內的 docker-compose(包含 Redis,Phase 0.2 提供):
```bash
docker compose up
```

### CI/CD 部署架構(dev / production)

CI/CD 在 `.gitlab-ci.yml` 部署 facade 時,會建立兩個容器加入主 stack 的 docker network(`gt-war-room-network[-dev]`):

| 容器 | 對外 port | 說明 |
|------|----------|------|
| `gt-war-room-superset-internal[-dev]` | 無(僅 docker network 內) | facade 專用 Superset。載入 `docker/pythonpath_facade/superset_config.py`,僅覆寫 `DASHBOARD_RBAC=False` 與 `TALISMAN_ENABLED=False`,**不跑 init**,共用主 stack 的 metadata DB 與 Redis(直接享受 `cache.warmup_cache` 預熱) |
| `gt-war-room-graphql-facade[-dev]` | `${PROD_FACADE_PORT}` / `${DEV_FACADE_PORT}` (預設 4000 / 4001) | facade GraphQL server。`SUPERSET_URL` 由 CI 注入指向 `gt-war-room-superset-internal[-dev]:8088` |

facade 容器使用獨立的 GitLab CI/CD file-type variable(`DEV_API` / `PROD_API`)作為 `--env-file`,內容範例見 [.env.example](./.env.example) 上方註解。

> **為何需要內部 Superset 容器?**
> 主 Superset 啟用 `DASHBOARD_RBAC`,非 Admin role(包含 facade 帳號)即使有全域 dashboard 讀取權限,沒被列在每個 dashboard 的 role 名單內就會被列表 API 過濾掉(回空清單)。內部 Superset 容器專門關閉 `DASHBOARD_RBAC` 讓 facade 能讀全部 dashboards,主 Superset UI 端的 RBAC 行為不受影響。

---

## 目錄結構

```
superset-graphql-facade/
├── PLAN.md              ← 完整規劃(架構、Schema、Phase 分階段)
├── PROGRESS.md          ← 執行進度 checklist(中斷後從此恢復)
├── CHANGELOG.md
├── LICENSE              ← Apache 2.0
├── package.json
├── tsconfig.json
├── Dockerfile
├── eslint.config.mjs
├── .prettierrc.json
├── jest.config.ts
├── .env.example
├── src/
│   ├── index.ts         ← GraphQL Yoga server entry + /health endpoint
│   ├── config.ts        ← zod env 驗證（PORT, SUPERSET_*, API_KEYS）
│   ├── logger.ts        ← pino structured logging
│   ├── schema/
│   │   ├── typeDefs.ts  ← GraphQL SDL（Dashboard/Chart/Column/ChartData）
│   │   └── scalars.ts   ← JSON / DateTime scalar
│   ├── resolvers/
│   │   ├── dashboard.ts ← dashboards() / dashboard(id) / Dashboard.charts
│   │   ├── chart.ts     ← chart(id) / Chart.columns / Chart.data
│   │   └── index.ts     ← 組合所有 resolvers
│   ├── superset/
│   │   ├── client.ts    ← JWT 自動續期、concurrent login guard
│   │   ├── csrf.ts      ← 每請求獨立 CSRF session
│   │   └── polling.ts   ← chart data fetch + async polling（5s/次，最多 90s）
│   ├── auth/
│   │   ├── apiKey.ts    ← API Key 解析
│   │   └── context.ts   ← GraphQL AppContext
│   └── cache/
│       └── index.ts     ← in-memory TTL cache（query_context 5min / data 1min）
└── test/
    ├── unit/
    └── integration/
```

---

## GraphQL Query 範例

```graphql
# 列出 dashboard
query {
  dashboards(pageSize: 5) {
    id
    title
    published
  }
}

# 取得 chart 欄位結構
query {
  chart(id: "1141") {
    name
    vizType
    columns { name type isMetric }
  }
}

# 取得 chart 數值（內部自動處理 CSRF + async polling）
query {
  chart(id: "1141") {
    data {
      rowCount
      columnNames
      cached
      rows
    }
  }
}

# 強制忽略 Superset 快取重新查詢
query {
  chart(id: "1141") {
    data(force: true) {
      rowCount
      rows
    }
  }
}
```

---

## 與本 monorepo 的關係

本子專案目前在 `gt-war-room/superset-graphql-facade/` 內維護,可以:
- 與 Superset 本體 (`superset/`) 同步演進
- 共用 root 的 `.git`,但 CI / 部署 / 版本完全獨立

未來如需切出獨立 repo,本目錄可直接 `git filter-repo`(或 `git subtree push`)推到:
```
git@github.com:Bright0505/superset-graphql-facade.git
```

---

## License

Apache License 2.0 — see [LICENSE](./LICENSE).
