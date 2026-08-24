# 今天这顿 — 项目约定

零后端 PWA：每天三个饭点各推荐一道外卖，单人自用，装在 iPhone 主屏上。
完整设计与取舍理由见 `docs/superpowers/specs/2026-08-22-meal-recommender-design.md`（历史档案，不必每次读）。

## 不可违反的约束

**零运行时依赖，零构建步骤。**
`package.json` 只允许有 `name` / `private` / `type` 三个字段。不要装任何 npm 包 —— 测试用 Node 自带的 `node --test`，图标由 `tools/make-icons.mjs` 用 stdlib 的 `zlib` 生成。

**纯函数边界 —— 这是整个测试套件成立的前提。**
以下五个文件不得触碰时钟、随机数、DOM 或存储：

```
src/config.js  src/dates.js  src/observations.js  src/recommender.js  src/snapshot.js
```

时间和随机源一律作为参数注入（`now`、`random`、`exportedAt`）。
`src/store.js` 是唯一被允许调用 `indexedDB`、`Date.now()`、`crypto.randomUUID()` 的模块。
把任何一次时钟读取推回纯模块，零依赖测试就全部失效。

**不注册 Service Worker。**
iOS 只靠 manifest 就能装到主屏。SW 只换来离线能力，代价是 iPhone 上最难排查的缓存问题 —— 这是明确砍掉的，不要「顺手加上」。

**不抓取外卖平台数据，不构造 URL scheme。**
跳转链接由用户在美团/饿了么里分享后粘贴进来。这是合规决定，不是技术选择。

**面向用户的文案一律简体中文**，包括抛出的错误消息 —— 它们会直接显示在界面上。
注意 `JSON.parse`、IndexedDB `DataError` 之类的引擎报错是英文的，必须单独捕获并替换成中文。

**可调常数只放 `src/config.js`。**
单位换算（`DAY_MS`）与结构标识（`DB_NAME`、`DB_VERSION`、`SNAPSHOT_VERSION`）不算可调项，留在各自模块里。

## 数据模型

事件日志**只追加，从不修改**。观察值（observation）由 `reduceObservations` 在每次读取时现算，从不存储 —— 所以评分公式可以随时改，并对全部历史重算。

反馈是**下一顿补问上一顿**的，因此 `rated` 事件通常比它所评价的那顿晚一天甚至跨天。事件靠 `targetTs` 显式回指自己属于哪条观察值；没有该字段的历史事件与导入的旧快照退回启发式（取同 slot 同 dish 中时间上最近的组）。**改归约逻辑前先读 spec §6.2** —— 这里踩过一次坑。

## 安全

候选池页面是唯一有外部数据进入的地方（用户粘贴的分享链接）。两条硬规则：

- 插进 `innerHTML` 的用户数据必须过 `esc()`，**属性值里也要**
- 链接只放行 `http:` / `https:`，保存时和渲染时都要查 —— `<input type="url">` 会把 `javascript:alert(1)` 当成合法 URL

## 开发

```bash
node --test                    # 全部测试
python -m http.server 8000     # 本地预览；ES modules 无法从 file:// 加载
```

`src/store.js` 与 `src/ui-*.js` **没有自动化测试**：Node 没有 `indexedDB`，而引入 `fake-indexeddb` 会破坏零依赖约束。这条线是有意画在这里的，覆盖它们的是 `README.md` 里的真机验收清单（尚未执行）。

## 协作偏好

- 用简体中文回复
- 不要 `git push`，不要动 `main` 分支 —— 部署时机由我决定
- `rm` 一类不可逆操作先问
