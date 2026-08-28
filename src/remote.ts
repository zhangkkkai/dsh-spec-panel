/** Browser Typert contribution for the Host `specPanel` service. */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SpecCreateChangeRequest, SpecCreateChangeResult, SpecListRequest, SpecListResult,
  SpecReadRequest, SpecReadResult, SpecWriteRequest, SpecWriteResult,
} from './spec-types.ts'
import { PACKAGE_NAME, SPEC_INVOCATIONS } from './typert-descriptors.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    specPanel: {
      list: (agentId: SessionId, request: SpecListRequest) => Promise<RemoteResult<SpecListResult>>
      read: (agentId: SessionId, request: SpecReadRequest) => Promise<RemoteResult<SpecReadResult>>
      write: (agentId: SessionId, request: SpecWriteRequest) => Promise<RemoteResult<SpecWriteResult>>
      createChange: (
        agentId: SessionId,
        request: SpecCreateChangeRequest,
      ) => Promise<RemoteResult<SpecCreateChangeResult>>
    }
  }
  interface TypertRemoteMap {
    'specPanel/list': (agentId: SessionId, request: SpecListRequest) => Promise<RemoteResult<SpecListResult>>
    'specPanel/read': (agentId: SessionId, request: SpecReadRequest) => Promise<RemoteResult<SpecReadResult>>
    'specPanel/write': (agentId: SessionId, request: SpecWriteRequest) => Promise<RemoteResult<SpecWriteResult>>
    'specPanel/createChange': (
      agentId: SessionId,
      request: SpecCreateChangeRequest,
    ) => Promise<RemoteResult<SpecCreateChangeResult>>
  }
  interface TypertRemoteScopeMap {
    'agent:specPanel/list': (request: SpecListRequest) => Promise<RemoteResult<SpecListResult>>
    'agent:specPanel/read': (request: SpecReadRequest) => Promise<RemoteResult<SpecReadResult>>
    'agent:specPanel/write': (request: SpecWriteRequest) => Promise<RemoteResult<SpecWriteResult>>
    'agent:specPanel/createChange': (
      request: SpecCreateChangeRequest,
    ) => Promise<RemoteResult<SpecCreateChangeResult>>
  }
}

export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: PACKAGE_NAME,
  descriptors: SPEC_INVOCATIONS,
}

export default TYPERT_REMOTE
