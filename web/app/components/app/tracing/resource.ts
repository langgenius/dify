import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'

export type TracingResource =
  | { kind: 'app'; appId: string; mode: AppMode }
  | { kind: 'agent'; agentId: string }

/** Resources on the Agent trace pipeline, where capture policy and provider capabilities apply. */
export function usesAgentTracePipeline(resource: TracingResource) {
  return (
    resource.kind === 'agent' || resource.mode === 'workflow' || resource.mode === 'advanced-chat'
  )
}
