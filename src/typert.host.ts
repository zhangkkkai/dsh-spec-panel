/** Host Typert contribution discovered through the package's `./typert` export. */

import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import { PACKAGE_NAME, SPEC_INVOCATIONS } from './typert-descriptors.ts'

export const TYPERT: TypertContribution = {
  package: PACKAGE_NAME,
  face: 'host',
  schemas: [],
  invocations: SPEC_INVOCATIONS,
  model: {
    services: [{
      key: 'specPanel',
      exportName: 'SpecService',
      summary: 'Read and maintain OpenSpec spec folders (specs/, changes/) under the session workspace.',
      tags: [],
      members: [],
      types: [],
    }],
    events: [],
    objects: [],
  },
}

export default TYPERT
