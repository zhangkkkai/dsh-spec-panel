/**
 * dsh-spec-panel plugin, browser half.
 *
 * Registers a "Spec" sidebar tab into dsh-better-sidebar — an SDD
 * (Spec-Driven Development) workbench over the session's OpenSpec store:
 * the fact-base `specs/`, active `changes/` (with proposal / design / tasks /
 * delta artifacts), checklist toggling that writes `tasks.md` back to disk,
 * and one-click scaffolding of new change folders.
 *
 * The Host service reaches the browser through the package's Typert remote:
 * the contribution is mounted here with `ctx.remote.$mount(TYPERT_REMOTE)`,
 * and the panel invokes it via `sessions.scope(id).get('remote.specPanel')`.
 * Every registration is wrapped in ctx.effect so fiber disposal (HMR /
 * plugin disable) unregisters cleanly.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from 'dsh-better-sidebar/client/service'
import type { TabDescriptor } from 'dsh-better-sidebar/client/service'
import { TYPERT_REMOTE } from '../remote.ts'
import { SpecPanel } from './SpecPanel.tsx'

/** Services required before mounting: the sidebar registry, the client remote,
 *  and the session scope provider. */
export const inject = ['betterSidebar', 'remote', 'sessions']

/** The tab icon: a rolled spec document with a checklist. */
function SpecIcon({ size }: { readonly size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 2.75h6.5l3 3V16a1.25 1.25 0 0 1-1.25 1.25h-8.5A1.25 1.25 0 0 1 4.5 16V4a1.25 1.25 0 0 1 1.25-1.25H6Z" />
      <path d="M12 2.75v3h3" />
      <path d="M7.5 9.5h5M7.5 12h3.5" />
    </svg>
  )
}

/** Client plugin body: mount the Typert remote, then register the Spec tab. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    let disposed = false
    let disposeRemote: (() => Promise<void>) | undefined
    void ctx.remote.$mount(TYPERT_REMOTE).then((dispose) => {
      if (disposed) void dispose()
      else disposeRemote = dispose
    }).catch((error: unknown) => {
      console.error('[dsh-spec-panel] remote mount error:', error)
    })
    return () => {
      disposed = true
      if (disposeRemote !== undefined) void disposeRemote()
    }
  }, 'dsh-spec-panel: typert remote')

  ctx.effect(() => ctx.betterSidebar.registerTab({
    id: 'spec',
    title: () => 'Spec',
    icon: (size: number) => <SpecIcon size={size} />,
    order: 45,
    single: true,
    component: ({ ctx: tabCtx, scope, visible }) => (
      <SpecPanel
        ctx={tabCtx as unknown as Context}
        sessionId={scope.sessionId}
        cwd={scope.cwd}
        visible={visible}
      />
    ),
  } satisfies TabDescriptor), 'dsh-spec-panel: register tab')
}

/** Re-export the panel for potential direct embedding. */
export { SpecPanel }
