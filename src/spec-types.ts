/**
 * Shared wire vocabulary between the Host `specPanel` service and the browser
 * contribution. Only lossless JSON crosses the Typert remote, so every type
 * here is a plain data shape.
 */

/** One source-of-truth spec under `openspec/specs/<domain>/spec.md`. */
export interface SpecEntry {
  /** Domain path relative to `openspec/specs/` (e.g. `"auth"`). */
  readonly domain: string
  /** Path relative to the openspec root (e.g. `"specs/auth/spec.md"`). */
  readonly path: string
  /** Whether `spec.md` exists on disk for this domain. */
  readonly exists: boolean
}

/** Lifecycle of one change folder, derived from files + task completion. */
export type ChangeStatus = 'proposed' | 'in-progress' | 'implemented' | 'archived'

/** One change folder under `openspec/changes/` (or its `archive/`). */
export interface ChangeEntry {
  /** Folder name (kebab-case). */
  readonly name: string
  /** Path relative to the openspec root (e.g. `"changes/add-dark-mode"`). */
  readonly path: string
  readonly status: ChangeStatus
  /** Presence of the four OpenSpec artifacts. */
  readonly artifacts: {
    readonly proposal: boolean
    readonly design: boolean
    readonly tasks: boolean
    readonly delta: boolean
  }
  /** Checkbox summary of `tasks.md`; null when the file does not exist. */
  readonly tasks: { readonly total: number; readonly done: number } | null
}

export interface SpecListRequest {
  /** Reserved for future filters. */
  readonly scope?: 'all' | 'active'
}

export interface SpecListResult {
  /** The resolved openspec root (absolute path), or null when the session has no workspace. */
  readonly root: string | null
  /** Source-of-truth specs: openspec/specs, one spec.md per domain. */
  readonly specs: readonly SpecEntry[]
  /** Active change folders: openspec/changes. */
  readonly changes: readonly ChangeEntry[]
  /** Archived change folders: openspec/changes/archive. */
  readonly archived: readonly ChangeEntry[]
}

export interface SpecReadRequest {
  /** Path relative to the openspec root. */
  readonly path: string
}

export interface SpecReadResult {
  readonly path: string
  readonly content: string
}

export interface SpecWriteRequest {
  /** Path relative to the openspec root. */
  readonly path: string
  readonly content: string
}

export interface SpecWriteResult {
  readonly ok: boolean
}

export interface SpecCreateChangeRequest {
  /** Kebab-case change name; sanitized host-side. */
  readonly name: string
}

export interface SpecCreateChangeResult {
  /** Created folder path relative to the openspec root (`changes/<name>`). */
  readonly path: string
  /** Files scaffolded from the OpenSpec templates. */
  readonly files: readonly string[]
}
