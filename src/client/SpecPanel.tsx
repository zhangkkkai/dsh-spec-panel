/**
 * The Spec workbench panel — the body of the "Spec" sidebar tab.
 *
 * Surfaces the session's OpenSpec store as three sections:
 * - 事实源 (specs/): each `<domain>/spec.md` as the living source of truth;
 * - 变更 (changes/): one card per change folder with inferred status
 *   (proposed → in-progress → implemented) and per-artifact navigation
 *   (proposal / design / tasks / delta). The tasks artifact is interactive:
 *   toggling a checkbox writes `tasks.md` back to disk through the Host
 *   service; every artifact can also be opened in better-sidebar's editor;
 * - 已归档 (changes/archive/): archived changes, read-only.
 */
import { useCallback, useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ChangeEntry, ChangeStatus, SpecCreateChangeRequest, SpecCreateChangeResult,
  SpecListRequest, SpecListResult, SpecReadRequest, SpecReadResult,
  SpecWriteRequest, SpecWriteResult,
} from '../spec-types.ts'
import { Markdown } from './Markdown.tsx'
import styles from './spec.module.css'

/** The `remote.specPanel` namespace face the client runtime mints from our Typert contribution. */
interface SpecPanelRemote {
  list(request: SpecListRequest): Promise<RemoteResult<SpecListResult>>
  read(request: SpecReadRequest): Promise<RemoteResult<SpecReadResult>>
  write(request: SpecWriteRequest): Promise<RemoteResult<SpecWriteResult>>
  createChange(request: SpecCreateChangeRequest): Promise<RemoteResult<SpecCreateChangeResult>>
}

type ArtifactKind = 'proposal' | 'design' | 'tasks' | 'delta'

const ARTIFACT_TABS: readonly { key: ArtifactKind; label: string }[] = [
  { key: 'proposal', label: '提案' },
  { key: 'design', label: '设计' },
  { key: 'tasks', label: '任务' },
  { key: 'delta', label: '增量' },
]

const STATUS_META: Record<ChangeStatus, { label: string; color: string }> = {
  'proposed': { label: '提案中', color: '#8e8e93' },
  'in-progress': { label: '实施中', color: '#f5a524' },
  'implemented': { label: '已完成', color: '#30a46c' },
  'archived': { label: '已归档', color: '#6e6e73' },
}

/** One parsed task row from tasks.md (the Nth checkbox in file order). */
interface TaskItem {
  readonly index: number
  readonly done: boolean
  readonly text: string
  readonly group: string
}

function parseTasks(content: string): TaskItem[] {
  const items: TaskItem[] = []
  let group = ''
  for (const line of content.split(/\r?\n/)) {
    const heading = /^##\s+(.*)$/.exec(line)
    if (heading !== null) {
      group = heading[1] ?? ''
      continue
    }
    const task = /^\s*-\s+\[([ xX])\]\s+(.*)$/.exec(line)
    if (task !== null) {
      items.push({
        index: items.length,
        done: (task[1] ?? ' ').toLowerCase() === 'x',
        text: task[2] ?? '',
        group,
      })
    }
  }
  return items
}

/** Flip the Nth checkbox of a tasks.md text and return the new content. */
function flipTask(content: string, target: number): string {
  let seen = 0
  return content.split(/\r?\n/).map((line) => {
    const match = /^(\s*-\s+\[)([ xX])(\]\s*.*)$/.exec(line)
    if (match === null) return line
    if (seen === target) {
      seen += 1
      const checked = (match[2] ?? ' ').toLowerCase() === 'x'
      return `${match[1]}${checked ? ' ' : 'x'}${match[3]}`
    }
    seen += 1
    return line
  }).join('\n')
}

export interface SpecPanelProps {
  readonly ctx: Context
  readonly sessionId: string
  readonly cwd?: string | undefined
  readonly visible: boolean
}

export function SpecPanel({ ctx, sessionId, cwd, visible }: SpecPanelProps) {
  const [data, setData] = useState<SpecListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contentCache, setContentCache] = useState<Record<string, string>>({})
  const [contentLoading, setContentLoading] = useState<string | null>(null)
  const [contentError, setContentError] = useState<string | null>(null)
  const [openSpec, setOpenSpec] = useState<string | null>(null)
  const [expandedChange, setExpandedChange] = useState<ChangeEntry | null>(null)
  const [artifact, setArtifact] = useState<ArtifactKind | null>(null)
  const [newChangeOpen, setNewChangeOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** Invoke one Host remote method bound to this session's scope. */
  const invoke = useCallback(async <T,>(
    method: keyof SpecPanelRemote,
    request: never,
  ): Promise<T> => {
    // The client runtime augments `ctx.sessions` as the session manager; the
    // Agent-scope API (`scope(id)`) lives on the ISessions face, so we read it
    // through the same explicit cast dsh-file-review-tab uses.
    const sessions = (ctx as unknown as { readonly sessions: ISessions }).sessions
    const scope = sessions.scope(sessionId as SessionId)
    if (scope === undefined) throw new Error('会话不可用')
    const remote = scope.get('remote.specPanel') as SpecPanelRemote | undefined
    if (remote === undefined) throw new Error('Spec 服务未就绪')
    const result = await (remote[method] as (req: never) => Promise<RemoteResult<T>>)(request)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }, [ctx, sessionId])

  const flashNotice = useCallback((text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice(null), 2500)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await invoke<SpecListResult>('list', { scope: 'all' } as never)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [invoke])

  // (Re)load when the panel becomes visible or the session changes.
  useEffect(() => {
    if (!visible) return
    void refresh()
  }, [visible, refresh])

  /** Read one artifact into the cache (no-op when already present). */
  const ensureContent = useCallback(async (path: string): Promise<string> => {
    const cached = contentCache[path]
    if (cached !== undefined) return cached
    setContentLoading(path)
    setContentError(null)
    try {
      const result = await invoke<SpecReadResult>('read', { path } as never)
      setContentCache((current) => ({ ...current, [path]: result.content }))
      return result.content
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setContentError(message)
      throw err
    } finally {
      setContentLoading((current) => (current === path ? null : current))
    }
  }, [contentCache, invoke])

  const openSpecFile = useCallback(async (path: string) => {
    setOpenSpec(path)
    setContentError(null)
    try {
      await ensureContent(path)
    } catch {
      // error surfaced through contentError
    }
  }, [ensureContent])

  const openChange = useCallback(async (change: ChangeEntry) => {
    setExpandedChange(change)
    const first = ARTIFACT_TABS.find((tab) => change.artifacts[tab.key])
    const kind: ArtifactKind | null = first?.key ?? null
    setArtifact(kind)
    setContentError(null)
    if (kind === null) return
    const path = `${change.path}/${kind === 'delta' ? 'specs' : kind}.md`
    try {
      await ensureContent(path)
    } catch {
      // error surfaced through contentError
    }
  }, [ensureContent])

  /** Expand a change, or collapse it when the currently-open one is re-clicked. */
  const toggleChange = useCallback((change: ChangeEntry) => {
    if (expandedChange?.path === change.path) {
      setExpandedChange(null)
      setArtifact(null)
      setContentError(null)
      return
    }
    void openChange(change)
  }, [expandedChange, openChange])

  const selectArtifact = useCallback(async (change: ChangeEntry, kind: ArtifactKind) => {
    setArtifact(kind)
    setContentError(null)
    const path = artifactPath(change, kind)
    try {
      await ensureContent(path)
    } catch {
      // error surfaced through contentError
    }
  }, [ensureContent])

  const toggleTask = useCallback(async (change: ChangeEntry, index: number) => {
    const path = `${change.path}/tasks.md`
    let content: string
    try {
      content = await ensureContent(path)
    } catch {
      return
    }
    const next = flipTask(content, index)
    try {
      await invoke<SpecWriteResult>('write', { path, content: next } as never)
      setContentCache((current) => ({ ...current, [path]: next }))
      flashNotice('已保存 tasks.md')
      await refresh()
    } catch (err) {
      setContentError(err instanceof Error ? err.message : String(err))
    }
  }, [ensureContent, invoke, refresh, flashNotice])

  const createChange = useCallback(async () => {
    const name = newName.trim()
    if (name === '') return
    setCreating(true)
    setCreateError(null)
    try {
      const result = await invoke<SpecCreateChangeResult>('createChange', { name } as never)
      setNewName('')
      setNewChangeOpen(false)
      flashNotice(`已创建 ${result.path}`)
      await refresh()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }, [newName, invoke, refresh, flashNotice])

  /** Open one artifact in better-sidebar's built-in editor tab. */
  const openInEditor = useCallback((relPath: string) => {
    if (data === null || data.root === null) return
    const absPath = `${data.root}/${relPath}`
    const title = relPath.split('/').pop() ?? relPath
    ctx.betterSidebar?.openTab(
      { type: 'editor', path: absPath, title },
      { sessionId, ...(cwd !== undefined ? { cwd } : {}) },
    )
  }, [data, ctx, sessionId, cwd])

  const rootLabel: string | null = (() => {
    const root = data?.root
    if (root === undefined || root === null) return null
    const parts = root.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? root
  })()

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.title}>Spec 工作台</span>
          {rootLabel !== null && <span className={styles.rootLabel} title={data?.root ?? undefined}>{rootLabel}/openspec</span>}
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.iconButton}
            title="刷新"
            onClick={() => void refresh()}
            disabled={loading}
          >⟳</button>
          <button
            className={styles.iconButton}
            title="新建变更"
            onClick={() => setNewChangeOpen((v) => !v)}
          >＋</button>
        </div>
      </div>

      <div className={styles.body}>
      {notice !== null && <div className={styles.notice}>{notice}</div>}

      {newChangeOpen && (
        <div className={styles.createRow}>
          <input
            className={styles.input}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createChange() }}
            placeholder="变更名（kebab-case，如 add-dark-mode）"
            disabled={creating}
          />
          <button
            className={styles.addButton}
            onClick={() => void createChange()}
            disabled={creating || newName.trim() === ''}
          >创建</button>
        </div>
      )}
      {createError !== null && <div className={styles.errorText}>{createError}</div>}

      {error !== null && (
        <div className={styles.errorText}>
          {error}
          <button className={styles.retryButton} onClick={() => void refresh()}>重试</button>
        </div>
      )}

      {data !== null && data.root === null && (
        <div className={styles.empty}>
          当前会话没有工作区目录。<br />请先打开一个工作区，面板会读取其中的 <code>openspec/</code> 目录。
        </div>
      )}

      {data !== null && data.root !== null && (
        <>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>事实源 specs/</span>
              <span className={styles.sectionCount}>{data.specs.length}</span>
            </div>
            {data.specs.length === 0 ? (
              <div className={styles.sectionEmpty}>没有 specs/ 目录，先通过「＋ 新建变更」开始一个变更</div>
            ) : (
              data.specs.map((spec) => (
                <div
                  key={spec.path}
                  className={`${styles.specRow} ${openSpec === spec.path ? styles.specRowActive : ''}`}
                  onClick={() => void openSpecFile(spec.path)}
                >
                  <span className={styles.specName}>{spec.domain}</span>
                  <span className={spec.exists ? styles.specExists : styles.specMissing}>
                    {spec.exists ? 'spec.md' : '缺 spec.md'}
                  </span>
                  <button
                    className={styles.miniButton}
                    title="在编辑器中打开"
                    onClick={(e) => { e.stopPropagation(); openInEditor(spec.path) }}
                  >↗</button>
                </div>
              ))
            )}
            {openSpec !== null && contentCache[openSpec] !== undefined && (
              <div className={styles.detailCard}>
                <div className={styles.detailHead}>
                  <span className={styles.detailTitle}>{openSpec}</span>
                  <button className={styles.miniButton} onClick={() => setOpenSpec(null)}>收起</button>
                </div>
                <Markdown content={contentCache[openSpec] ?? ''} />
              </div>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>变更 changes/</span>
              <span className={styles.sectionCount}>{data.changes.length}</span>
            </div>
            {data.changes.length === 0 ? (
              <div className={styles.sectionEmpty}>没有活跃变更</div>
            ) : (
              data.changes.map((change) => (
                <ChangeCard
                  key={change.path}
                  change={change}
                  expanded={expandedChange?.path === change.path}
                  artifact={artifact}
                  contentLoading={contentLoading}
                  contentError={contentError}
                  content={artifact !== null ? contentCache[artifactPath(change, artifact)] : undefined}
                  onToggle={() => toggleChange(change)}
                  onSelectArtifact={(kind) => void selectArtifact(change, kind)}
                  onToggleTask={(index) => void toggleTask(change, index)}
                  onOpenEditor={openInEditor}
                />
              ))
            )}
          </section>

          {data.archived.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <span>已归档 archive/</span>
                <span className={styles.sectionCount}>{data.archived.length}</span>
              </div>
              {data.archived.map((change) => (
                <div key={change.path} className={styles.specRow}>
                  <span className={styles.specName}>{change.name}</span>
                  <span className={styles.statusBadge} style={{ color: STATUS_META.archived.color, borderColor: STATUS_META.archived.color }}>
                    {STATUS_META.archived.label}
                  </span>
                </div>
              ))}
            </section>
          )}

          {loading && <div className={styles.loading}>刷新中…</div>}
        </>
      )}

      {data === null && loading && <div className={styles.loading}>加载中…</div>}
      </div>
    </div>
  )
}

function artifactPath(change: ChangeEntry, kind: ArtifactKind): string {
  if (kind === 'delta') return `${change.path}/specs`
  return `${change.path}/${kind}.md`
}

interface ChangeCardProps {
  readonly change: ChangeEntry
  readonly expanded: boolean
  readonly artifact: ArtifactKind | null
  readonly contentLoading: string | null
  readonly contentError: string | null
  readonly content: string | undefined
  readonly onToggle: () => void
  readonly onSelectArtifact: (kind: ArtifactKind) => void
  readonly onToggleTask: (index: number) => void
  readonly onOpenEditor: (relPath: string) => void
}

function ChangeCard(props: ChangeCardProps) {
  const { change, expanded } = props
  const meta = STATUS_META[change.status]
  const { proposal, design, tasks, delta } = change.artifacts
  const progress = change.tasks
  const kind = props.artifact

  return (
    <div className={styles.changeCard}>
      <div className={styles.changeHead} onClick={props.onToggle}>
        <span className={styles.changeName}>{change.name}</span>
        <span className={styles.statusBadge} style={{ color: meta.color, borderColor: meta.color }}>
          {meta.label}
        </span>
        <span className={styles.toggleArrow}>{expanded ? '▾' : '▸'}</span>
      </div>
      <div className={styles.changeMeta}>
        <span className={proposal ? styles.chipOn : styles.chipOff}>提案</span>
        <span className={design ? styles.chipOn : styles.chipOff}>设计</span>
        <span className={tasks ? styles.chipOn : styles.chipOff}>任务</span>
        <span className={delta ? styles.chipOn : styles.chipOff}>增量</span>
        {progress !== null && (
          <span className={styles.progress}>
            {progress.done}/{progress.total}
          </span>
        )}
      </div>

      {expanded && (
        <div className={styles.changeBody}>
          <div className={styles.artifactTabs}>
            {ARTIFACT_TABS.map((tab) => {
              const exists = change.artifacts[tab.key]
              return (
                <button
                  key={tab.key}
                  className={`${styles.artifactTab} ${kind === tab.key ? styles.artifactTabActive : ''} ${exists ? '' : styles.artifactTabMissing}`}
                  onClick={() => props.onSelectArtifact(tab.key)}
                  title={exists ? undefined : '该工件尚未创建'}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {kind === null && (
            <div className={styles.sectionEmpty}>这个变更还没有任何工件</div>
          )}

          {kind === 'tasks' && props.content !== undefined && (
            <TaskList
              content={props.content}
              onChange={props.onToggleTask}
              onOpenEditor={() => props.onOpenEditor(`${change.path}/tasks.md`)}
            />
          )}

          {kind !== null && kind !== 'tasks' && props.content !== undefined && (
            <div className={styles.detailCard}>
              <div className={styles.detailHead}>
                <span className={styles.detailTitle}>{artifactPath(change, kind)}</span>
                {kind !== 'delta' && (
                  <button
                    className={styles.miniButton}
                    title="在编辑器中打开"
                    onClick={() => props.onOpenEditor(artifactPath(change, kind))}
                  >↗</button>
                )}
              </div>
              <Markdown content={props.content} />
            </div>
          )}

          {kind !== null && props.content === undefined && (
            <div className={styles.loading}>
              {props.contentLoading !== null ? '加载中…' : (props.contentError ?? '无法读取')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface TaskListProps {
  readonly content: string
  readonly onChange: (index: number) => void
  readonly onOpenEditor: () => void
}

function TaskList({ content, onChange, onOpenEditor }: TaskListProps) {
  const items = parseTasks(content)
  let lastGroup: string | null = null
  return (
    <div className={styles.taskBlock}>
      <div className={styles.detailHead}>
        <span className={styles.detailTitle}>tasks.md</span>
        <button className={styles.miniButton} title="在编辑器中打开" onClick={onOpenEditor}>↗</button>
      </div>
      {items.map((item) => {
        const showGroup = item.group !== lastGroup
        lastGroup = item.group
        return (
          <div key={item.index}>
            {showGroup && <div className={styles.taskGroup}>{item.group}</div>}
            <div
              className={styles.taskRow}
              onClick={() => onChange(item.index)}
              role="checkbox"
              aria-checked={item.done}
            >
              <span className={item.done ? styles.mdChecked : styles.mdUnchecked}>
                {item.done ? '✓' : ''}
              </span>
              <span className={item.done ? styles.taskDone : styles.taskText}>{item.text}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
