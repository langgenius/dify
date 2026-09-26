import type { EnvironmentVariableItemResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { useWorkflowStore } from './store'
import type { EventEmitterValue } from '@/context/event-emitter'
import { DSL_EXPORT_CHECK } from './constants'

export type ExportSecretEnvironmentVariable = Pick<
  EnvironmentVariableItemResponse,
  'name' | 'value'
>

export type ExportSecretEnvironmentEvent = {
  type: typeof DSL_EXPORT_CHECK
  payload: {
    target: ReturnType<typeof useWorkflowStore>
    data: ExportSecretEnvironmentVariable[]
  }
}

export function isExportSecretEnvironmentEvent(
  event: EventEmitterValue,
): event is ExportSecretEnvironmentEvent {
  return typeof event !== 'string' && event.type === DSL_EXPORT_CHECK
}
