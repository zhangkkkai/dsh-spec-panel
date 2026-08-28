/**
 * Host-side `specPanel` service: reads and maintains OpenSpec folders
 * (`openspec/specs/`, `openspec/changes/`) under the requesting session's
 * workspace. Exposed to the browser half through the package's Typert remote.
 *
 * Scope: every operation is confined to `<session-cwd>/openspec` — paths are
 * resolved and verified inside that root, so the panel can never touch files
 * outside the spec store (mirrors the fence dsh-file-review-tab keeps around
 * its own workspace).
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ChangeEntry, ChangeStatus, SpecCreateChangeRequest, SpecCreateChangeResult,
  SpecEntry, SpecListRequest, SpecListResult, SpecReadRequest, SpecReadResult,
  SpecWriteRequest, SpecWriteResult,
} from './spec-types.ts'

/** The OpenSpec store directory name, relative to the session workspace. */
const OPENSPEC_DIR = 'openspec'

/** The checkout task line, e.g. `- [ ] 1.1 …` or `- [x] 2.3 …`. */
const TASK_LINE = /^\s*-\s+\[([ xX])\]\s*.*$/

function sessionCwd(agent: Agent): string | null {
  const cwd = agent.session.header.cwd
  if (cwd === undefined || cwd.trim() === '') return null
  return cwd
}

/** Whether `candidate` resolves inside `root` (or equals it). */
function inside(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Read a directory, tolerating absence. */
async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

/** Count `- [ ]` / `- [x]` checkboxes in a tasks.md file. */
async function countTasks(path: string): Promise<{ total: number; done: number } | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return null
  }
  let total = 0
  let done = 0
  for (const line of text.split(/\r?\n/)) {
    const match = TASK_LINE.exec(line)
    if (match === null) continue
    total += 1
    if (match[1]?.toLowerCase() === 'x') done += 1
  }
  return { total, done }
}

/** Sanitize a change folder name to safe kebab-case (no separators, no traversal). */
function sanitizeChangeName(name: string): string {
  const cleaned = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    throw new Error('变更名无效：请使用字母、数字与连字符（kebab-case）')
  }
  return cleaned
}

/** Infer a change's status from its artifacts + tasks.md completion. */
function inferStatus(hasTasks: boolean, summary: { total: number; done: number } | null): ChangeStatus {
  if (summary === null || !hasTasks || summary.total === 0) return 'proposed'
  if (summary.done >= summary.total) return 'implemented'
  if (summary.done > 0) return 'in-progress'
  return 'proposed'
}

const PROPOSAL_TEMPLATE = `## Why

<!-- Explain the motivation for this change. What problem does this solve? Why now? -->

## What Changes

<!-- Describe what will change. Be specific about new capabilities, modifications, or removals. -->

## Capabilities

### New Capabilities
<!-- Capabilities being introduced. Use kebab-case for path segments you introduce
     (e.g., user-auth or identity/user-auth) that follow the project's existing
     spec organization. Each creates specs/<capability-path>/spec.md. -->
- \`<capability-path>\`: <brief description of what this capability covers>

### Modified Capabilities
<!-- Existing capabilities whose REQUIREMENTS are changing (not just implementation).
     Only list here if spec-level behavior changes. Each needs a delta spec file.
     Use the exact existing path under openspec/specs/. Leave empty if no requirement
     changes. -->
- \`<existing-capability-path>\`: <what requirement is changing>

## Impact

<!-- Affected code, APIs, dependencies, systems -->
`

const DESIGN_TEMPLATE = `## Context

<!-- Current state and constraints that shape the approach. See proposal.md for motivation - don't restate it -->

## Goals / Non-Goals

**Goals:**
<!-- What this design aims to achieve -->

**Non-Goals:**
<!-- What is explicitly out of scope -->

## Decisions

<!-- Key design decisions with rationale and alternatives considered -->

## Risks / Trade-offs

<!-- Known risks and trade-offs -->
`

const TASKS_TEMPLATE = `## 1. <!-- Task Group Name -->

- [ ] 1.1 <!-- Task description -->
- [ ] 1.2 <!-- Task description -->

## 2. <!-- Task Group Name -->

- [ ] 2.1 <!-- Task description -->
- [ ] 2.2 <!-- Task description -->
`

/** The Host service published as the `specPanel` Remote namespace. */
export class SpecService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'specPanel')
  }

  /** Resolve the session's openspec root (absolute), or null when it has no workspace. */
  private openspecRoot(agent: Agent): string | null {
    const cwd = sessionCwd(agent)
    if (cwd === null) return null
    return resolve(cwd, OPENSPEC_DIR)
  }

  private requireRoot(agent: Agent): string {
    const root = this.openspecRoot(agent)
    if (root === null) throw new Error('当前会话没有工作区目录')
    return root
  }

  /** Resolve a request path strictly inside the openspec root. */
  private resolveInside(root: string, relPath: string): string {
    if (relPath === '' || relPath.startsWith('/') || relPath.includes('\0')) {
      throw new Error('无效的文件路径')
    }
    const candidate = resolve(root, relPath)
    if (!inside(root, candidate)) throw new Error('路径超出 openspec 目录范围')
    return candidate
  }

  /** List the fact-base specs, active changes, and archived changes. */
  async list(agent: Agent, _request: SpecListRequest): Promise<SpecListResult> {
    const root = this.openspecRoot(agent)
    if (root === null) return { root: null, specs: [], changes: [], archived: [] }
    const [specs, changes, archived] = await Promise.all([
      this.readSpecs(root),
      this.readChanges(root, 'changes', false),
      this.readChanges(root, join('changes', 'archive'), true),
    ])
    return { root, specs, changes, archived }
  }

  private async readSpecs(root: string): Promise<SpecEntry[]> {
    const domains = await safeReaddir(join(root, 'specs'))
    const specs: SpecEntry[] = []
    for (const domain of domains) {
      if (domain.startsWith('.')) continue
      if (!(await isDirectory(join(root, 'specs', domain)))) continue
      const specPath = join(root, 'specs', domain, 'spec.md')
      specs.push({ domain, path: `specs/${domain}/spec.md`, exists: await isFile(specPath) })
    }
    return specs.sort((a, b) => a.domain.localeCompare(b.domain))
  }

  private async readChanges(root: string, base: string, archived: boolean): Promise<ChangeEntry[]> {
    const names = await safeReaddir(join(root, base))
    const changes: ChangeEntry[] = []
    for (const name of names) {
      if (name.startsWith('.')) continue
      const abs = join(root, base, name)
      if (!(await isDirectory(abs))) continue
      changes.push(await this.readChange(name, join(base, name), root, archived))
    }
    return changes.sort((a, b) => a.name.localeCompare(b.name))
  }

  private async readChange(
    name: string,
    relPath: string,
    root: string,
    archived: boolean,
  ): Promise<ChangeEntry> {
    const abs = resolve(root, relPath)
    const [proposal, design, tasks, delta] = await Promise.all([
      isFile(join(abs, 'proposal.md')),
      isFile(join(abs, 'design.md')),
      isFile(join(abs, 'tasks.md')),
      isDirectory(join(abs, 'specs')),
    ])
    const summary = tasks ? await countTasks(join(abs, 'tasks.md')) : null
    return {
      name,
      path: relPath,
      status: archived ? 'archived' : inferStatus(tasks, summary),
      artifacts: { proposal, design, tasks, delta },
      tasks: summary,
    }
  }

  /** Read one artifact's UTF-8 text. A directory target (the `specs/` delta
   *  folder) resolves to its single spec.md, or to an index listing when it
   *  holds several. */
  async read(agent: Agent, request: SpecReadRequest): Promise<SpecReadResult> {
    const root = this.requireRoot(agent)
    const target = this.resolveInside(root, request.path)
    if (await isDirectory(target)) {
      const mdFiles = await this.findMarkdown(target)
      const first = mdFiles[0]
      if (mdFiles.length === 1 && first !== undefined) {
        const content = await readFile(first, 'utf8')
        return { path: relative(root, first), content }
      }
      if (mdFiles.length === 0) throw new Error('该目录下没有 spec.md')
      const index = mdFiles.map((file) => `- \`${relative(root, file)}\``).join('\n')
      return { path: request.path, content: `# 增量 specs/\n\n${index}\n` }
    }
    if (!(await isFile(target))) throw new Error('文件不存在：' + request.path)
    const content = await readFile(target, 'utf8')
    return { path: request.path, content }
  }

  /** Recursively collect markdown files under a directory. */
  private async findMarkdown(dir: string): Promise<string[]> {
    const out: string[] = []
    const stack = [dir]
    while (stack.length > 0) {
      const current = stack.pop()
      if (current === undefined) break
      const entries = await safeReaddir(current)
      for (const entry of entries) {
        const abs = join(current, entry)
        if (await isDirectory(abs)) {
          stack.push(abs)
        } else if (entry.endsWith('.md')) {
          out.push(abs)
        }
      }
    }
    return out.sort()
  }

  /** Write one artifact (used to persist tasks.md checkbox toggles). */
  async write(agent: Agent, request: SpecWriteRequest): Promise<SpecWriteResult> {
    const root = this.requireRoot(agent)
    const file = this.resolveInside(root, request.path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, request.content, 'utf8')
    return { ok: true }
  }

  /** Scaffold a new change folder from the OpenSpec templates. */
  async createChange(
    agent: Agent,
    request: SpecCreateChangeRequest,
  ): Promise<SpecCreateChangeResult> {
    const root = this.requireRoot(agent)
    const name = sanitizeChangeName(request.name)
    const relDir = join('changes', name)
    const abs = this.resolveInside(root, relDir)
    const specsDir = join(abs, 'specs')
    await mkdir(specsDir, { recursive: true })
    const files = ['proposal.md', 'design.md', 'tasks.md', 'specs/.gitkeep']
    await writeFile(join(abs, 'proposal.md'), PROPOSAL_TEMPLATE, 'utf8')
    await writeFile(join(abs, 'design.md'), DESIGN_TEMPLATE, 'utf8')
    await writeFile(join(abs, 'tasks.md'), TASKS_TEMPLATE, 'utf8')
    await writeFile(join(specsDir, '.gitkeep'), '', 'utf8')
    return { path: relDir, files }
  }
}
