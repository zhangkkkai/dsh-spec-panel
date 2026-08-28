/**
 * dsh-spec-panel plugin, node half.
 *
 * Instantiates the `specPanel` Host service (OpenSpec store reads/writes,
 * scoped to the session workspace). The browser half ships via exports[
 * "./client"] and reaches this service through the package's Typert remote
 * contribution (exports["./typert"] + exports["./remote"]).
 */

import type { Context } from '@deepseek-ai/cordis'
import { SpecService } from './spec-service.ts'

export type * from './spec-types.ts'
export { SpecService } from './spec-service.ts'

/**
 * Host plugin body: register the spec store service. No hard service
 * dependencies — the Typert bridge registers through the host context.
 */
export function apply(ctx: Context): void {
  new SpecService(ctx)
}
