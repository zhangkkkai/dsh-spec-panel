# 基于 dsh-better-sidebar 开发配套插件：规范与实践

> 面向 **DeepSeek Harness 插件开发者**的配套插件开发规范。本文档以仓库内的 [dsh-todo-panel](../) 为实战案例（第一个完整落地项目），结合 [dsh-better-sidebar 官方接入指南](https://github.com/omdsh-dev/DSH-better-sidebar/blob/master/docs/external-plugin-guide.md) 整理，目标是让任何开发者都能按照本文档从零开发、构建、安装、发布一个侧边栏配套插件。

---

## 1. 总览

dsh-better-sidebar 是一个**服务化的侧边栏框架**：它把 `ctx.betterSidebar` 服务开放给所有插件，通过两个扩展点让第三方插件能力与内置功能完全对等：

| 扩展点 | 方法 | 作用 |
|--------|------|------|
| **新页面（Tab）** | `registerTab(descriptor)` | 注册一种新的侧边栏 tab 类型，出现在侧边栏 `+` 菜单 |
| **文件预览器（Viewer）** | `registerFileViewer(descriptor)` | 注册一种文件类型预览器，覆盖/补充内置预览 |

**核心机制**：better-sidebar 的 client half 在 `apply()` 中执行 `ctx.provide('betterSidebar', service)`；消费插件在 `inject` 里声明 `'betterSidebar'`，Cordis 保证服务就绪后才激活插件，然后调用 `registerTab` / `registerFileViewer` 完成注册。注册返回的 disposer 由 Cordis fiber 在卸载（HMR / 禁用）时自动调用。

> ⚠️ **服务只在 client half**：`ctx.betterSidebar` 只存在于浏览器侧。host 半没有这个服务；host 半需要 better-sidebar 数据时走它自己的 HTTP/WS 路由（`/sidebar/api/*` 等）。

---

## 2. 前置条件

- **DeepSeek Harness web** 已安装且能正常运行（`dsh web`）
- **dsh-better-sidebar** 已安装（≥ 0.12.0，推荐最新）
- **Node.js ≥ 20**、**pnpm ≥ 10**
- 熟悉 TypeScript、React（hooks）、Cordis 插件模型

---

## 3. 项目结构规范

一个标准配套插件项目（参考 [dsh-todo-panel](../)）：

```
dsh-todo-panel/
├── package.json          # 包声明 + dsh bundle/client 元数据（见 §4）
├── tsconfig.json         # TS 编译配置（见 §5）
├── tsdown.config.ts      # 构建配置（host ESM + client CJS 双产物，见 §6）
├── cordis.patch.yml      # bundle 挂载声明（见 §7）
├── src/
│   ├── index.ts          # host 半入口（浏览器专用插件可为空操作）
│   ├── css-modules.d.ts  # CSS Module 类型声明
│   └── client/
│       ├── index.tsx     # client 半入口：注册 Tab/Viewer + React 组件（核心）
│       └── *.module.css  # 样式（CSS Module，主题 token 驱动）
├── README.md             # 项目说明 + 安装方式
├── LICENSE               # 开源许可（建议 MIT）
└── .gitignore            # 排除 node_modules/ lib/
```

**关键约定**：
- `src/client/` 是插件主体（配套插件几乎都是浏览器侧能力）
- `src/index.ts` host 入口保持最小（无 host 逻辑就只导空 `apply`）
- 构建产物 `lib/` 不提交（.gitignore），发布时由 `files` 字段控制
- 每个插件用**独立仓库**（如 `zhangkkkai/dsh-todo-panel`），命名 `dsh-<功能>` 前缀

---

## 4. package.json 规范

```jsonc
{
  "name": "dsh-todo-panel",                    // 包名：dsh-<功能>
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",                       // host 入口产物
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "files": [                                    // 发布内容白名单
    "lib/index.js",
    "lib/client.js",
    "lib/client.js.map",
    "lib/types/**/*.d.ts",
    "cordis.patch.yml",
    "README.md"
  ],
  "dsh": {                                      // DSH 插件元数据（关键！）
    "bundle": { "patch": "./cordis.patch.yml" }, // 声明 bundle patch 文件
    "client": {
      "inject": ["@deepseek-ai/dsh-client-runtime", "dsh-better-sidebar"],
      "platform": "web"
    }
  },
  "scripts": {
    "build:types": "tsc --emitDeclarationOnly --outDir lib/types",
    "build": "npm run build:types && tsdown",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {                          // 必须 peer，避免重复实例
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-client-runtime": ">=0.1.0-rc.5 <0.2.0",
    "dsh-better-sidebar": ">=0.12.0",
    "react": "^18.2.0"
  },
  "peerDependenciesMeta": {
    "dsh-better-sidebar": { "optional": true }   // 未装 better-sidebar 时插件仍可加载
  }
}
```

**规范要点**：

1. **`exports` 必须暴露 `./client` 子路径**——DSH web 通过它发现 client bundle（`package.json` 的 `dsh.client` 声明配合）。
2. **`dsh.bundle.patch`** 指向 `cordis.patch.yml`，profile 安装后自动合并该 patch 挂载插件行。
3. **`dsh.client.inject`** 声明 client 半需要的运行时服务（`@deepseek-ai/dsh-client-runtime` 是基础，`dsh-better-sidebar` 是你要用的服务）。
4. **`dsh-better-sidebar` 必须是 peerDependency**（不是 dependency），避免两份实例；`optional: true` 让它在未安装时安全跳过。
5. **devDependencies 里固定一个可用版本**（如 `dsh-better-sidebar: 0.13.0`）用于类型编译。

---

## 5. tsconfig.json 规范

```jsonc
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",                        // 允许 JSX（构建期编译）
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "verbatimModuleSyntax": false,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "rootDir": "src",
    "outDir": "lib/types"
  },
  "include": ["src"]
}
```

> **JSX 说明**：配套插件源码可以用 JSX（与动态 Cordis 插件不同，那是运行时受限环境）。`tsdown` 会在构建期编译 JSX 为 `React.createElement`。

---

## 6. 构建配置（tsdown.config.ts）

配套插件产出**两个产物**：
- **host 半**：`lib/index.js`（ESM，Node 平台）——入口 `src/index.ts`
- **client 半**：`lib/client.js`（CJS + `__ModuleLoader__` 包装，浏览器平台）——入口 `src/client/index.tsx`

完整配置参考 [tsdown.config.ts](../tsdown.config.ts)，核心要点：

```ts
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime']  // react 不打包，运行时 require

// client 半关键配置
{
  entry: { client: 'src/client/index.tsx' },
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  deps: { neverBundle: [...CLIENT_EXTERNALS] },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: "dsh-todo-panel", factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
```

**CSS Module 处理**：CSS 通过 lightningcss 编译成 `<style>` 元素注入（`cssModulesPlugin`），每个样式带 `data-plugin-css` 标记，重复加载自动跳过。样式类名 hash 化（`[hash]_[local]`），天然隔离不冲突。

---

## 7. cordis.patch.yml 与安装

### 7.1 bundle patch 声明（插件仓库内）

```yaml
# cordis.patch.yml —— 插件自带的挂载声明
- insert:
    - id: todo-panel
      name: 'dsh-todo-panel'
```

这个文件被 `package.json` 的 `dsh.bundle.patch` 引用。**好处**：用户用 `dsh plugin add` 安装时，patch 自动合并到 profile，无需手动编辑挂载行。

### 7.2 安装到 profile

```sh
# 发布后（npm / GitHub 源）
dsh plugin --profile web add dsh-todo-panel

# 本地开发（link 方式）
# 1. 编辑 ~/.dsh/profiles/web/package.json：
#    dependencies 加 "dsh-todo-panel": "file:/path/to/dsh-todo-panel"
#    dsh.profile.bundles 加 "dsh-todo-panel"
# 2. 在 profile 目录 pnpm install
```

### 7.3 生效方式

- **client 半改动**：浏览器**硬刷新**（Cmd/Ctrl+Shift+R）即可（DSH 对 client 改动热加载）
- **host 半改动 / 新增 bundle**：**重启 dsh web**（在启动它的终端 Ctrl+C 后重新 `pnpm dsh web`）

---

## 8. Client 接入规范（核心）

### 8.1 最小骨架

```tsx
// src/client/index.tsx
import type {} from 'dsh-better-sidebar/client/service'  // 触发 ctx.betterSidebar 类型合并
import type { Context } from '@deepseek-ai/cordis'

export const inject = ['betterSidebar']  // 服务就绪后才激活

export function apply(ctx: Context): void {
  const bs = ctx.get('betterSidebar')
  if (bs === undefined) return  // 未安装 better-sidebar 时安全跳过

  ctx.effect(() => bs.registerTab({
    id: 'todo',
    title: () => 'TODO',
    icon: (size) => <span style={{ fontSize: `${size}px` }}>☑</span>,
    order: 60,
    single: true,
    component: ({ scope }) => <TodoPanel scope={scope} />,
  }))
}
```

**三条铁律**：
1. **注册必须包在 `ctx.effect(...)` 里**——disposer 由 Cordis 在卸载时自动调用，否则 HMR / 禁用后注册残留，下次激活抛 `"already registered"`。
2. **`inject = ['betterSidebar']`** 声明硬依赖，Cordis 保证服务就绪。
3. **`ctx.get('betterSidebar')` 判空**——`optional` 依赖的稳妥读法。

### 8.2 数据访问：`scope`

Tab 组件收到 `scope: SessionScope`，含当前会话信息：

```ts
interface SessionScope {
  sessionId: string      // 当前会话 id
  cwd?: string           // 会话工作目录（可能为空）
  repoRoot?: string      // 工作区容器的 Git 根
}
```

`sessionId` 是**会话隔离**的基石——所有按会话存储的数据都应以其为 key。

### 8.3 数据持久化

配套插件（浏览器侧）的**首选持久化是 localStorage**：

```ts
const STORAGE_PREFIX = 'dsh-todo-panel:'

function loadTasks(sessionId: string | undefined): TodoItem[] {
  if (sessionId === undefined) return []
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + sessionId)
    if (raw === null) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function saveTasks(sessionId: string | undefined, items: TodoItem[]): void {
  if (sessionId === undefined) return
  try { localStorage.setItem(STORAGE_PREFIX + sessionId, JSON.stringify(items)) } catch {}
}
```

- better-sidebar 自身就是用 localStorage 持久化布局（`dsh-sidebar:v1:<id>`），这是生态惯例
- key 用 `插件名:会话id`，天然会话隔离，刷新不丢失
- 会话切换时用 `useEffect(() => { setItems(loadTasks(sessionId)) }, [sessionId])` 跟随会话重载

> 需要 host 能力（读写任意文件、跑命令）时才引入 host 半 + Typert Remote（见 §12 参考），纯面板插件通常不需要。

### 8.4 样式规范

- **CSS Module**（`*.module.css`）+ 构建期 hash，避免与其他插件冲突
- **只使用 DSH 主题 token**，跟随皮肤：

| Token | 用途 |
|-------|------|
| `--dsw-alias-bg-base` | 基础背景 |
| `--dsw-alias-bg-layer-1` / `-2` | 抬升表面（卡片/输入框背景） |
| `--dsw-alias-border-l1` / `-2` | 边框 |
| `--dsw-alias-brand-primary` | 品牌主色 |
| `--dsw-alias-label-primary` / `-secondary` | 文字 |
| `--dsw-alias-state-error-primary` | 错误色 |
| `--dsw-alias-state-warn-primary` | 警告色 |
| `--dsw-alias-state-success-primary` | 成功色 |

- 优先级等业务颜色用**固定色值**（如 `#e5484d`），不随主题
- 不要使用旧的 `--bg-*` / `--text-*` 变量（已废弃）

---

## 9. Tab 注册 API 速查

### 9.1 TabDescriptor 常用字段

```ts
interface TabDescriptor {
  id: string                        // 唯一；建议包前缀 'my-plugin:db'
  title: string | (() => string)    // 标题（i18n 友好）
  icon?: ReactNode | ((size: number) => ReactNode)
  order?: number                    // + 菜单排序（升序，默认 100）
  hidden?: boolean                  // 从 + 菜单隐藏（由其他流程触发打开）
  single?: boolean                  // 单实例：打开时聚焦已有 tab 而非新开
  dedupeKey?: (tab: SidebarTab) => string | undefined
  badge?: (ctx, scope, state) => string | number | null | undefined  // tab 角标
  onOpen?: (tab, scope) => void     // 生命周期回调
  onActivate?: (tab, scope) => void
  onClose?: (tab, scope) => void
  component: (props: TabComponentProps) => ReactNode  // 页面组件
}
```

### 9.2 TabComponentProps

```ts
interface TabComponentProps {
  ctx: Context
  store: SidebarStore       // 侧边栏全局状态
  scope: SessionScope       // 当前会话（sessionId/cwd/repoRoot）
  tab: SidebarTab
  visible: boolean          // 是否激活且面板打开（非激活时暂停重活）
  // 资源管理器相关（可选）：
  expanded?: string[]
  revealed?: string[]
  onToggleDir?: (path: string) => void
  onReferenceFile?: (path: string) => void
  onOpenFile?: (path: string) => void
  onOpenDiff?: (tab: SidebarTab) => void
  onSubagentJump?: (childSessionId: string) => void
}
```

### 9.3 内置 tab 清单（**不可重复注册**）

`explorer`(10)、`git`(20)、`subagent`(30)、`terminal`(40)、`browser`、`editor`、`diff`——这些 id 已被占用，自定义 tab 必须用**自己的 id**（建议包前缀）。

---

## 10. 构建与验证流程

```sh
# 1. 安装依赖
pnpm install

# 2. 类型检查
pnpm run typecheck

# 3. 构建（tsc 类型 + tsdown 双产物）
pnpm run build

# 4. 验证产物
#    lib/index.js   —— host 半
#    lib/client.js  —— client 半（含 __ModuleLoader__ 包装 + CSS 注入）
```

**构建成功的标志**：`lib/client.js` 开头应包含 `window.__ModuleLoader__.load({ id: "<包名>", ...`。

**安装后验证**：
```sh
# 插件 client bundle 可访问（HTTP 200）
curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3080/plugins/<包名>/client.js"

# boot 配置含插件条目
curl -s http://127.0.0.1:3080/ | grep -o '"id":"<包名>"[^}]*'
```

---

## 11. 常见坑与规避

| 陷阱 | 规避 |
|------|------|
| **注册残留** | `registerTab` / `registerFileViewer` 必须包在 `ctx.effect()` 里 |
| **重复 id 崩溃** | tab/viewer id 用包前缀（`my-plugin:xxx`），不撞内置 id |
| **value-import dsh-better-sidebar** | 只能 `import type {} from 'dsh-better-sidebar/...'`（类型擦除）；运行时符号禁止导入 |
| **host 半访问 ctx.betterSidebar** | 服务只在 client 半；host 需要数据走 `/sidebar/api/*` HTTP |
| **会话切换不刷新** | 数据 key 绑定 `sessionId`，`useEffect` 跟随 `sessionId` 重载；**不要**用 React `key` 强制重挂载（better-sidebar Tab 环境下会崩溃） |
| **用废弃 CSS 变量** | 只用 `--dsw-alias-*` 主题 token |
| **动态插件 vs npm 插件混淆** | 动态 Cordis 插件是进程内临时原型；正式配套插件是 npm 项目（本文档） |
| **client 改动不生效** | 硬刷新浏览器；host 改动 / 新增 bundle 需重启 dsh web |

---

## 12. 进阶：文件预览器与 host 能力

### 12.1 文件预览器（registerFileViewer）

```tsx
ctx.effect(() => bs.registerFileViewer({
  id: 'my-plugin:csv',
  exts: ['csv'],                    // 匹配扩展名；exts: [] 为全匹配
  fetchStrategy: 'custom',          // 'custom' 自己拉数据；'path'/'url' 直接给路径
  load: async (path, scope) => { /* 读取并解析 */ },
  component: ({ customData, path }) => <CsvGrid data={customData} path={path} />,
}))
```

### 12.2 host 能力（Typert Remote）

需要 host 半能力（文件读写、命令）时，用 **Typert Remote** 模式（参考 dsh-file-review-tab）：
- host 半实现服务，通过 `TypertRemoteService` 暴露
- client 半通过 `ctx.remote` 调用，`src/remote.ts` 声明类型 + `TYPERT_REMOTE` 贡献
- 需要 `src/typert.host.ts`（host 贡献）+ `src/typert-descriptors.ts`（调用描述符）

---

## 13. 参考实现

- **[dsh-todo-panel](https://github.com/zhangkkkai/dsh-todo-panel)**：本仓库，纯 client 配套插件完整示例（Tab 注册 + localStorage + CSS Module + 构建）
- **[dsh-file-review-tab](https://github.com/Lzh3070/dsh-file-review-tab)**：含 host 能力（Typert Remote）+ diff 渲染的复杂示例
- **[dsh-better-sidebar 官方指南](https://github.com/omdsh-dev/DSH-better-sidebar/blob/master/docs/external-plugin-guide.md)**：API 权威文档
- **dsh-better-sidebar `src/client/builtins/`**：内置 7 tab + 6 viewer 的"吃狗粮"参考实现

---

## 14. 开发 Checklist

- [ ] 项目命名 `dsh-<功能>`，独立仓库
- [ ] `package.json`：exports 含 `./client`、`dsh.bundle.patch`、`dsh.client.inject`、peer 依赖 + optional
- [ ] `tsconfig.json`：JSX、strict、declaration
- [ ] `tsdown.config.ts`：host ESM + client CJS（`__ModuleLoader__` + CSS Module 插件）
- [ ] `cordis.patch.yml`：`- insert` 挂载行
- [ ] client 入口：`inject: ['betterSidebar']` + `ctx.get` 判空 + `ctx.effect` 包裹注册
- [ ] Tab id 带包前缀，不撞内置
- [ ] 数据持久化：localStorage key 绑定 sessionId
- [ ] 样式：CSS Module + 仅 `--dsw-alias-*` token
- [ ] `pnpm run typecheck` 通过
- [ ] `pnpm run build` 成功，client.js 含 `__ModuleLoader__`
- [ ] 安装到 profile 并验证（client bundle 200 + boot 条目）
- [ ] README 写明安装方式、前置依赖、使用说明
