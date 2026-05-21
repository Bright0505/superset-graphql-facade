# Superset GraphQL Façade — 串接指南

本文件說明如何從外部應用程式（前端、後端服務、AI Agent）串接 Superset GraphQL Façade。

---

## 端點

| 環境 | GraphQL Endpoint |
|------|-----------------|
| 開發 | `http://<host>:4001/graphql` |
| 正式 | `http://<host>:4000/graphql` |
| 健康檢查 | `GET /health`（不需認證） |

> Port 由部署時的 `DEV_FACADE_PORT` / `PROD_FACADE_PORT` 環境變數決定。

---

## 認證

所有 GraphQL 請求需在 HTTP Header 帶入 API Key：

```
Authorization: Bearer <your-api-key>
```

API Key 由管理員在伺服器端 `API_KEYS` 環境變數設定，格式為 `name:key`，例如：

```
API_KEYS=internal-frontend:abcd1234,partner-x:efgh5678
```

### Rate Limit

預設每個 API Key 每分鐘 60 次請求（sliding window）。超過限制會收到 HTTP 429。管理員可透過 `RATE_LIMIT_RPM` 調整，設為 `0` 可停用。

---

## 請求格式

標準 GraphQL over HTTP POST：

```http
POST /graphql
Authorization: Bearer abcd1234
Content-Type: application/json

{
  "query": "query { ... }",
  "variables": { ... }
}
```

---

## 查詢一覽

### 1. 列出 Dashboard

```graphql
query {
  dashboards(search: "銷售", page: 0, pageSize: 10) {
    id
    title
    slug
    published
  }
}
```

| 參數 | 類型 | 說明 |
|------|------|------|
| `search` | String | 關鍵字（模糊比對標題） |
| `page` | Int | 頁碼，從 0 開始（預設 0） |
| `pageSize` | Int | 每頁筆數（預設 25） |

---

### 2. 取得單一 Dashboard

```graphql
query {
  dashboard(id: "5") {
    id
    title
    published
  }
}
```

---

### 3. 查詢 Dashboard 的選項卡（Tabs）

```graphql
query {
  dashboard(id: "5") {
    tabs {
      id    # 格式：TAB-xxxxxxxx，傳入 charts(tab:) 時使用
      name  # 選項卡顯示名稱
    }
  }
}
```

---

### 4. 取得 Dashboard 內的圖表清單

**全部圖表：**

```graphql
query {
  dashboard(id: "5") {
    charts {
      id
      name
      vizType
    }
  }
}
```

**只取特定選項卡的圖表：**

```graphql
query {
  dashboard(id: "5") {
    tabs { id name }
    charts(tab: "TAB-xxxxxxxx") {
      id
      name
      vizType
    }
  }
}
```

> `tab` 參數填入 `tabs.id` 的值。未傳入時回傳全部圖表。

---

### 5. 取得圖表欄位結構

```graphql
query {
  chart(id: "1141") {
    name
    vizType
    columns {
      name
      label
      type      # STRING / NUMERIC / DATETIME / BOOLEAN
      isMetric  # true = 指標, false = 維度
    }
  }
}
```

---

### 6. 取得圖表資料

**基本查詢：**

```graphql
query {
  chart(id: "1141") {
    data {
      rowCount
      columnNames
      rows       # JSON array，每筆為 object
      cached
      cachedAt
    }
  }
}
```

**強制略過 Superset 快取：**

```graphql
query {
  chart(id: "1141") {
    data(force: true) {
      rowCount
      rows
    }
  }
}
```

**加入篩選條件（filters）：**

```graphql
query {
  chart(id: "1141") {
    data(filters: [
      { col: "store_id", op: "==", val: "G001" }
    ]) {
      rowCount
      rows
    }
  }
}
```

**多條件篩選（AND 關係）：**

```graphql
query {
  chart(id: "1141") {
    data(filters: [
      { col: "region",  op: "IN",  val: ["North", "East"] },
      { col: "revenue", op: ">=",  val: 10000 },
      { col: "year",    op: "==",  val: 2024 }
    ]) {
      rowCount
      columnNames
      rows
    }
  }
}
```

**支援的 `op` 運算子：**

| op | 意義 |
|----|------|
| `==` | 等於 |
| `!=` | 不等於 |
| `IN` | 在列表中（val 為陣列） |
| `NOT IN` | 不在列表中（val 為陣列） |
| `>` | 大於 |
| `<` | 小於 |
| `>=` | 大於等於 |
| `<=` | 小於等於 |

> filters 與圖表本身原有的查詢條件為**疊加（AND）**關係，不會取代原有條件。不同 filters 組合各自獨立快取。

---

### 7. AI Agent 用的圖表 Introspection

```graphql
query {
  chartIntrospection(id: "1141") {
    chartId
    chartName
    vizType
    description    # 自然語言描述，適合作為 LLM tool description
    parameters {
      name
      label
      type
      isMetric
      description
    }
    exampleQuery   # 可直接複製執行的 GraphQL query 字串
  }
}
```

---

## 常見串接流程

### 流程 A：顯示指定 Dashboard 的所有圖表資料

```graphql
# Step 1：取得 dashboard 資訊與選項卡
query {
  dashboard(id: "5") {
    title
    tabs { id name }
  }
}

# Step 2：依選項卡取得圖表清單
query {
  dashboard(id: "5") {
    charts(tab: "TAB-xxxxxxxx") {
      id
      name
      vizType
    }
  }
}

# Step 3：取得各圖表的資料（可帶 filters）
query {
  chart(id: "1141") {
    data {
      columnNames
      rows
    }
  }
}
```

### 流程 B：搜尋 Dashboard 並一次查詢（合併請求）

```graphql
query DashboardWithData {
  dashboard(id: "5") {
    title
    tabs { id name }
    charts(tab: "TAB-xxxxxxxx") {
      id
      name
      data(filters: [{ col: "year", op: "==", val: 2024 }]) {
        rowCount
        columnNames
        rows
        cached
      }
    }
  }
}
```

---

## 程式碼範例

### JavaScript / TypeScript（fetch）

```typescript
const ENDPOINT = 'http://localhost:4000/graphql';
const API_KEY = 'abcd1234';

async function queryGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data as T;
}

// 取得圖表資料
const data = await queryGraphQL(`
  query {
    chart(id: "1141") {
      data(filters: [{ col: "store_id", op: "==", val: "G001" }]) {
        rowCount
        rows
      }
    }
  }
`);
```

### Python（requests）

```python
import requests

ENDPOINT = "http://localhost:4000/graphql"
API_KEY = "abcd1234"

def query_graphql(query: str, variables: dict = None):
    res = requests.post(
        ENDPOINT,
        json={"query": query, "variables": variables or {}},
        headers={"Authorization": f"Bearer {API_KEY}"},
    )
    res.raise_for_status()
    data = res.json()
    if "errors" in data:
        raise RuntimeError(data["errors"][0]["message"])
    return data["data"]

# 取得圖表資料
result = query_graphql("""
  query {
    chart(id: "1141") {
      data(filters: [{ col: "store_id", op: "==", val: "G001" }]) {
        rowCount
        rows
      }
    }
  }
""")
```

---

## 快取行為

| 資料類型 | TTL |
|---------|-----|
| Dashboard position_json（選項卡）| 5 分鐘 |
| Chart query_context | 5 分鐘 |
| Chart data（無 filter）| 1 分鐘 |
| Chart data（有 filter）| 1 分鐘（按 filter 內容獨立快取） |
| Chart introspection | 5 分鐘 |

使用 `force: true` 可略過 Façade 的 dedup cache，強制重新向 Superset 查詢。

---

## 錯誤處理

| 錯誤碼 | 原因 |
|--------|------|
| `UNAUTHENTICATED` | Authorization header 缺失或 API Key 無效 |
| `RATE_LIMITED` | 超過每分鐘請求上限 |
| `CHART_NO_QUERY_CONTEXT` | 該圖表在 Superset 尚未儲存 query_context |
| `TIMEOUT` | Superset async 查詢逾時（> 90 秒） |
| `SUPERSET_ERROR` | Superset API 回傳 HTTP 錯誤 |

錯誤格式遵循 GraphQL 標準：

```json
{
  "errors": [
    {
      "message": "錯誤描述",
      "extensions": { "code": "ERROR_CODE" }
    }
  ]
}
```
