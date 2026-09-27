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
- 只读审查链接：为已保存方案生成不可变快照（含当时的坐标、禁飞区与服务端校验结果），输出短链接 `#/r/<token>` 供另一位安全员只读复核；支持设置有效期、复制地址与随时撤销，后续编辑不会改变已发出的快照。
- 纯 TypeScript：前端与后端均没有使用纯 JavaScript 源文件。

## 目录结构

```text
.
├── backend/
│   ├── src/
│   │   ├── geometry.ts
│   │   ├── server.ts
│   │   ├── snapshotStore.ts
│   │   ├── store.ts
│   │   └── types.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── api.ts
│   │   ├── App.tsx
│   │   ├── format.ts
│   │   ├── geometry.ts
│   │   ├── main.tsx
│   │   ├── ReviewPage.tsx
│   │   ├── reviewApi.ts
│   │   ├── reviewLinks.ts
│   │   ├── RouteCanvas.tsx
│   │   ├── snapshotApi.ts
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

删除指定方案。

## 只读审查链接

用于「提交前由另一位安全员只读复核」的场景：把当前方案冻结成不可变快照，生成短链接发给复核人；复核人打开后是明确的只读视图，可以看到快照创建时间、来源方案和冻结时的校验结果（当前风险）。后续对原方案的编辑、甚至删除，都不会改变已发出的快照。

### `POST /api/plans/:id/snapshots`

为指定方案创建快照。请求体：`{ "ttlHours": 168 }`（`0` 表示长期有效，默认 7 天，最大 90 天）。支持 `Idempotency-Key` 请求头做幂等去重：同一方案 + 同一幂等键重复提交会返回首次创建的快照（`reused: true`），重复点击 / 网络重试不会产生多份快照。

- 快照内容：创建时的方案深拷贝（服务端冻结）+ 当时服务端计算的校验结果。
- 返回快照元信息与 16 位短令牌 `token`，审查地址为 `<前端地址>/#/r/<token>`。
- 边界：`409 SNAPSHOT_LIMIT`（单方案有效快照达到上限，默认 20 个）、`413 SNAPSHOT_TOO_LARGE`（方案体超过快照大小上限，默认 256 KB）、`400 INVALID_TTL`。

### `GET /api/plans/:id/snapshots`

列出指定方案的全部快照（含已撤销 / 已过期），供编辑侧管理。

### `DELETE /api/snapshots/:id`

撤销指定快照，立即生效且幂等；撤销后审查链接返回 `410 SNAPSHOT_REVOKED`。

### `GET /api/review/:token`

公开只读接口，返回快照的方案、冻结的校验结果与来源信息（`source.exists` 表示源方案是否仍在、`source.updatedAt` 可用于判断源方案在快照后是否又被编辑过）。该接口仅接受 `GET`，其它方法一律 `405`；令牌不存在返回 `404`，已撤销 / 已过期返回 `410`。

前端只读页（`#/r/<token>`）按需加载，编辑工作台及其编辑 / 撤销 API 不会进入只读页的初始包；链接失效（撤销、过期、不存在）时展示明确的失效页面。

相关环境变量：`SNAPSHOT_MAX_PER_PLAN`（默认 20）、`SNAPSHOT_MAX_BYTES`（默认 262144）、`SNAPSHOT_DEFAULT_TTL_HOURS`（默认 168）。

## 说明

当前的路径生成器是基础折线规划器，不会自动绕过障碍物；当路径穿越禁飞区时，会在画布和右侧校验卡片中明确标出风险。后续可以在此基础上接入 A*、可见图或 RRT 等避障算法。
