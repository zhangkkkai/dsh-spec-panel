/** Strict Typert codecs shared by the Host and browser contribution artifacts. */

import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

export const PACKAGE_NAME = 'dsh-spec-panel'

const agentCodec = {
  mode: 'strict' as const,
  typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
  schema: z.intersection(z.string(), z.unknown()),
}

const specEntrySchema = z.object({
  domain: z.string(),
  path: z.string(),
  exists: z.boolean(),
})

const changeEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  status: z.enum(['proposed', 'in-progress', 'implemented', 'archived']),
  artifacts: z.object({
    proposal: z.boolean(),
    design: z.boolean(),
    tasks: z.boolean(),
    delta: z.boolean(),
  }),
  tasks: z.object({ total: z.number().int(), done: z.number().int() }).nullable(),
})

const listRequestSchema = z.object({
  scope: z.enum(['all', 'active']).optional(),
})

const listResultSchema = z.object({
  root: z.string().nullable(),
  specs: z.array(specEntrySchema),
  changes: z.array(changeEntrySchema),
  archived: z.array(changeEntrySchema),
})

const readRequestSchema = z.object({ path: z.string() })
const readResultSchema = z.object({ path: z.string(), content: z.string() })

const writeRequestSchema = z.object({ path: z.string(), content: z.string() })
const writeResultSchema = z.object({ ok: z.boolean() })

const createChangeRequestSchema = z.object({ name: z.string() })
const createChangeResultSchema = z.object({
  path: z.string(),
  files: z.array(z.string()),
})

function codec(typeSymbol: string, schema: z.ZodType): {
  mode: 'strict'
  typeSymbol: string
  schema: z.ZodType
} {
  return { mode: 'strict', typeSymbol, schema }
}

function descriptor(
  method: 'list' | 'read' | 'write' | 'createChange',
  requestSchema: z.ZodType,
  resultSchema: z.ZodType,
  requestType: string,
  resultType: string,
): InvocationDescriptor {
  return {
    id: `${PACKAGE_NAME}#specPanel/${method}`,
    service: 'specPanel',
    namespace: 'specPanel',
    method,
    invocation: { kind: 'direct' },
    scope: { context: 'agent', wire: 'agentId' },
    parameters: [{
      name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: agentCodec,
    }, {
      name: 'request', wire: 'request', source: 'json',
      codec: codec(`${PACKAGE_NAME}#${requestType}`, requestSchema),
    }],
    result: codec(`${PACKAGE_NAME}#${resultType}`, resultSchema),
  }
}

export const SPEC_INVOCATIONS: readonly InvocationDescriptor[] = [
  descriptor('list', listRequestSchema, listResultSchema, 'SpecListRequest', 'SpecListResult'),
  descriptor('read', readRequestSchema, readResultSchema, 'SpecReadRequest', 'SpecReadResult'),
  descriptor('write', writeRequestSchema, writeResultSchema, 'SpecWriteRequest', 'SpecWriteResult'),
  descriptor('createChange', createChangeRequestSchema, createChangeResultSchema, 'SpecCreateChangeRequest', 'SpecCreateChangeResult'),
]
