import type { CreateAppPayload } from '@dify/contracts/api/console/apps/types.gen'

export type AppType = CreateAppPayload['mode']
export type WorkflowAppMode = Extract<AppType, 'workflow' | 'advanced-chat'>

export const APP_TYPES = [
  'workflow',
  'advanced-chat',
  'chat',
  'agent-chat',
  'completion',
] as const satisfies readonly AppType[]

export function isWorkflowAppMode(mode: string): mode is WorkflowAppMode {
  return mode === 'workflow' || mode === 'advanced-chat'
}
