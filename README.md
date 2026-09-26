# SkyRoute · 无人机航线规划与禁飞区可视化工具

项目 5：一个使用 **React + Vite + TypeScript** 构建的二维无人机航线规划工作台，配套 **Node.js + Express + TypeScript** 内存 REST API。

## 已实现功能

- 二维坐标画布：100 × 70 km 的坐标网格、主/次网格线、坐标刻度和北向指示。
- 航线节点编辑：设置起点、终点，点击添加航点，侧栏可删除航点。
- 禁飞区绘制：点击放置矩形禁飞区，逐点绘制并完成多边形禁飞区。
- 基础路径生成：按「起点 → 航点列表 → 终点」顺序生成折线路径。
- 路径校验：检查节点是否越界、航段是否与禁飞多边形/矩形区域相交；风险航段使用红色虚线高亮。
- 距离计算：实时计算航线总距离，并展示航段数量。
- 方案管理：通过 REST API 保存、读取和删除方案；当前使用进程内存存储，服务重启后数据清空。
- 只读审查链接：一键固化不可变方案快照（坐标、禁飞区与当时的校验结果），生成可复制的短链接 `/r/:token`；复核人打开后进入明确的只读视图，可看到快照创建时间、来源方案与当前风险；链接支持有效期与撤销，撤销/过期/错误链接均有清晰的失效页面；后续编辑不影响已发出的快照。
- 纯 TypeScript：前端与后端均没有使用纯 JavaScript 源文件。

## 目录结构

```text
.
├── backend/
│   ├── src/
│   │   ├── geometry.ts
│   │   ├── server.ts
│   │   ├── store.ts
│   │   └── types.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── api.ts
│   │   ├── App.tsx
│   │   ├── geometry.ts
│   │   ├── main.tsx
│   │   ├── styles.css
│   │   └── types.ts
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts
├── .gitignore
└── package.json
```

## 运行方式

当前仅完整落盘，**未安装依赖**。准备运行时，在项目根目录执行：

```bash
npm install
npm run dev
```

- 前端：<http://localhost:5173>
- 后端：<http://localhost:4000>
- 健康检查：<http://localhost:4000/api/health>

生产构建：

```bash
npm run build
npm start
```

## REST API

### `GET /api/plans`

返回当前进程内保存的所有方案。

### `GET /api/plans/:id`

返回指定方案。

### `POST /api/plans`

创建或更新方案。更新时带上 `id`，最小请求结构如下：

```json
{
  "name": "厂区巡检",
  "canvas": { "width": 100, "height": 70 },
  "start": { "x": 10, "y": 55 },
  "end": { "x": 90, "y": 15 },
  "waypoints": [{ "x": 32, "y": 40 }],
  "noFlyZones": [
    {
      "id": "zone-1",
      "name": "施工区",
      "kind": "rectangle",
      "points": [
        { "x": 40, "y": 20 },
        { "x": 60, "y": 20 },
        { "x": 60, "y": 35 },
        { "x": 40, "y": 35 }
      ],
      "color": "#fb7185"
    }
  ]
}
```

响应中会附带 `validation`，包含 `valid`、`distance` 和 `issues`。

### `DELETE /api/plans/:id`

删除指定方案。删除方案不会连带删除审查快照——快照内嵌了方案副本，已发出的审查链接仍然可以打开。

## 只读审查快照

审查链接面向复核安全员：链接里只有只读令牌，页面不挂载任何编辑控件，也不调用方案写接口。

### 设计要点

- **不可变快照**：创建时深拷贝并冻结方案副本与服务端当时重新计算的 `validation`（不是客户端传入），原方案之后的改名、改坐标、增删禁飞区都不影响快照。
- **短链接双令牌**：对外令牌 20 位 URL 安全字符（`/r/:token` → `GET /api/review/:token`，唯一的只读入口）；另发 24 位 `manageToken`，仅用于撤销，从不出现在只读响应中。
- **可撤销 / 可过期**：撤销必须携带 `X-Manage-Token`；TTL 以 `ttlSeconds` 传入（正整数，秒；不传或 `null` 为长期有效）。撤销与过期均返回 `410` 并区分 `reason: revoked | expired`，错误 id/令牌一律 `404`，只读响应带 `Cache-Control: private, no-store`。
- **重复生成**：同一方案内容用 sha256 指纹（键排序后哈希）去重，内容未变时复用现有活动快照（`reused: true`、HTTP 200）；`force: true` 可强制重发一条；已过期/已撤销的快照不参与复用。
- **大方案边界**：单个快照序列化体积上限 512 KB，超限返回 `413`（含 `sizeBytes/maxBytes`）；请求体超过 1 MB 由 Express 限制并返回 JSON 错误。

### `POST /api/plans/:id/snapshots`

为已保存方案创建快照（会先校验方案存在，返回 201；去重复用时返回 200）。

```json
{ "ttlSeconds": 604800, "force": false }
```

响应：

```json
{
  "reused": false,
  "snapshot": {
    "token": "fupgiqp3qivqbjcyzawm",
    "manageToken": "Ab3x…（仅管理面使用，撤销凭据）",
    "status": "active",
    "createdAt": "2026-09-26T11:13:56.215Z",
    "expiresAt": "2026-10-03T11:13:56.215Z",
    "revokedAt": null
  }
}
```

### `GET /api/plans/:id/snapshots`

方案管理面查看快照历史（含状态与 `manageToken`）。

### `DELETE /api/plans/:id/snapshots/:token`

撤销快照，必须带请求头 `X-Manage-Token: <manageToken>`；撤销幂等（重复撤销返回 204），凭据错误 403，快照不属于该方案 404。

### `GET /api/review/:token`

只读复核入口，返回快照创建时间、来源方案（id/name）、冻结的方案与校验结果，**不含 `manageToken`**，且不提供任何 POST/PUT/DELETE 能力。

| 情况 | 状态码 | body.reason |
| --- | --- | --- |
| 正常 | 200 | — |
| 已撤销 | 410 | `revoked`（含 `revokedAt`） |
| 已过期 | 410 | `expired`（含 `expiredAt`） |
| 令牌格式错误 / 不存在 | 404 | `not-found` |

前端在 `/r/:token` 渲染只读视图（顶部只读横幅、快照信息、坐标/禁飞区列表、风险航段红色高亮、快照校验卡片），并针对上述三种失效状态与离线分别展示独立页面。

## 说明

当前的路径生成器是基础折线规划器，不会自动绕过障碍物；当路径穿越禁飞区时，会在画布和右侧校验卡片中明确标出风险。后续可以在此基础上接入 A*、可见图或 RRT 等避障算法。
