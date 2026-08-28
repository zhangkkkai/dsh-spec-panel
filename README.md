# dsh-spec-panel

一个基于 **dsh-better-sidebar** 的 SDD（规范驱动开发，Spec-Driven Development）配套插件：在侧边栏提供一个 **Spec 工作台**，围绕 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 的标准目录结构，让「先写规范 → 再实现 → 再验证」的流程一目了然、可操作。

**核心亮点**：spec 不是存在浏览器里的数据，而是**工作区里真实的文件**（`openspec/` 目录）。host 半负责读写文件，client 半通过 Typert Remote 调用，勾选任务清单会直接写回 `tasks.md`。
<img width="694" height="1044" alt="image" src="https://github.com/user-attachments/assets/aa097732-c2a2-4bdf-9d47-cadc24e8c9d2" />

## 功能

| 模块 | 说明 |
|------|------|
| **事实源 specs/** | 列出 `openspec/specs/<domain>/spec.md`，点击即渲染需求 + 场景 |
| **变更工作台 changes/** | 每个变更一张卡片：提案 / 设计 / 任务 / 增量 四个工件齐全度、任务进度、状态徽标 |
| **状态推断** | 不引入额外状态文件：按工件存在 + `tasks.md` 完成度推断 `提案中 → 实施中 → 已完成`（归档目录恒为 `已归档`） |
| **任务清单** | 直接勾选 `tasks.md` 的复选框，**写回磁盘**，实时刷新进度 |
| **模板新建** | 一键创建 `openspec/changes/<name>/`，使用 OpenSpec 官方模板（proposal / design / tasks / specs） |
| **已归档 archive/** | 展示 `openspec/changes/archive/` 的历史变更 |
| **编辑器联动** | 每个工件可一键在 better-sidebar 内置 editor 中打开（绝对路径） |

## 前置条件

- **DeepSeek Harness web**（`dsh web`）已安装
- **dsh-better-sidebar** ≥ 0.16.0（`ctx.betterSidebar` 服务）
- Node.js ≥ 20、pnpm ≥ 10（仅开发需要）

## 安装

### 方式一：发布到 npm / GitHub 源后

```sh
dsh plugin --profile web add dsh-spec-panel
```

### 方式二：本地开发（link）

1. 编辑 `~/.dsh/profiles/web/package.json`：

```jsonc
{
  "dependencies": {
    "dsh-spec-panel": "file:/path/to/dsh-spec-panel"
  },
  "dsh": {
    "profile": {
      "bundles": [ "…", "dsh-spec-panel" ]
    }
  }
}
```

2. 在 profile 目录执行 `pnpm install`
3. **重启 `dsh web`**（新增 bundle 需重启），浏览器硬刷新（Cmd/Ctrl+Shift+R）

## 使用

1. 打开一个**工作区**（面板读取其下的 `openspec/` 目录）
2. 侧边栏 `+` 菜单 → **Spec**（或已打开的 tab）
3. 首次使用：点「＋」输入变更名（kebab-case，如 `add-dark-mode`）→ 自动生成四个工件模板
4. 在「任务」tab 勾选/取消任务，改动实时写回 `tasks.md`；用「↗」在编辑器中打开任意工件继续完善

## OpenSpec 目录结构

面板兼容 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 标准布局：

```
<workspace>/openspec/
├── specs/<domain>/spec.md     # 事实源（系统当前行为）
├── changes/<change-name>/
│   ├── proposal.md            # 为什么 / 改什么
│   ├── design.md              # 怎么做
│   ├── tasks.md               # 实施清单（勾选）
│   └── specs/<domain>/spec.md # 增量 spec（ADDED/CHANGED/REMOVED）
└── changes/archive/           # 已归档变更
```

> 装上 [openspec CLI](https://github.com/Fission-AI/OpenSpec) 后，面板管理的目录可以直接配合 `openspec` 命令使用（`/opsx:*` 工作流）。

## 开发

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run build       # build:types + tsdown（host ESM + client CJS 双产物）
```

**构建成功的标志**：`lib/client.js` 开头包含 `window.__ModuleLoader__.load({ id: "dsh-spec-panel", ...`。

### 项目结构

```
src/
├── index.ts              # host 半入口：实例化 SpecService
├── spec-service.ts       # host 服务：openspec/ 读写、状态推断、模板脚手架（TypertRemoteService）
├── spec-types.ts         # 共享 wire 类型
├── typert-descriptors.ts # zod codecs + InvocationDescriptor[]
├── typert.host.ts        # host Typert 贡献（./typert）
├── remote.ts             # browser Typert 贡献（./remote + 类型合并）
└── client/
    ├── index.tsx         # client 入口：mount remote + registerTab('spec')
    ├── SpecPanel.tsx     # 工作台面板
    ├── Markdown.tsx      # 安全 Markdown 渲染（无 HTML 注入）
    └── spec.module.css   # CSS Module，仅 --dsw-alias-* 主题 token
```

### 架构要点

- **数据作用域**：所有文件操作都限定在 `<会话cwd>/openspec` 内，路径解析后校验，越界即拒绝（参照 dsh-file-review-tab 的围栏做法）
- **远程调用**：client 通过 `ctx.sessions.scope(sessionId).get('remote.specPanel')` 调用 host 服务；host 从 `agent.session.header.cwd` 推导 openspec 根
- **三条铁律**：注册包在 `ctx.effect` 里；`inject` 声明硬依赖 + `ctx.get` 判空；tab id 不与内置冲突（内置：explorer/git/subagent/terminal/browser/editor/diff）

## 参考

- [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) — 侧边栏底座
- [OpenSpec](https://github.com/Fission-AI/OpenSpec) — spec 目录标准与 CLI
- [dsh-file-review-tab](https://github.com/Lzh3070/dsh-file-review-tab) — Typert Remote + host 能力参考实现
- [dsh-todo-panel](https://github.com/zhangkkkai/dsh-todo-panel) — 纯 client 配套插件参考实现

## License

MIT
