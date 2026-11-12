import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { ExternalAgentOverview } from '../model'
import type { ExternalAgentWorkflowPreviewNodeData } from './types'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { matchNotSystemVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { asRecord } from '../model'
import { externalAgentDefaultOutputs } from './defaults'
import {
  getExternalAgentTaskVariableIssues,
  resolveExternalAgentTaskVariable,
} from './task-variables'

export function containsExternalFileOutput(value: unknown): boolean {
  const output = asRecord(value)
  return (
    output.type === 'file' ||
    (Array.isArray(output.children) && output.children.some(containsExternalFileOutput)) ||
    (!!output.array_item && containsExternalFileOutput(output.array_item))
  )
}

function isSupportedOutput(value: unknown): boolean {
  const output = asRecord(value)
  const strategy = asRecord(output.failure_strategy)
  if (asRecord(strategy.retry).enabled === true || asRecord(output.check).enabled === true)
    return false
  if (
    Object.values(asRecord(output.file)).some((value) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value),
    )
  )
    return false
  if (
    strategy.on_failure !== undefined &&
    strategy.on_failure !== 'stop' &&
    strategy.on_failure !== 'default_value'
  )
    return false
  if (asRecord(output.array_item).type === 'array') return false
  if (
    containsExternalFileOutput(output) &&
    ('default_value' in output || strategy.on_failure === 'default_value')
  )
    return false
  if (Array.isArray(output.children) && !output.children.every(isSupportedOutput)) return false
  return !output.array_item || isSupportedOutput(output.array_item)
}

export function hasUnsupportedExternalOutputs(outputs: DeclaredOutputConfig[] = []) {
  return outputs.some((output) => !isSupportedOutput(output))
}

export function getExternalAgentNodeIssues(
  data: ExternalAgentWorkflowPreviewNodeData,
  overview: ExternalAgentOverview | undefined,
  enabled: boolean | undefined,
  availableVars: NodeOutPutVar[],
  fileModes: readonly string[],
) {
  const issues: (
    | 'unconnected'
    | 'taskRequired'
    | 'disabled'
    | 'unavailable'
    | 'detailUnavailable'
    | 'outputUnsupported'
    | 'invalidVariable'
  )[] = []
  if (!data.agent_binding?.agent_id || !data.agent_binding.binding_epoch) issues.push('unconnected')
  if (!data.agent_task?.trim()) issues.push('taskRequired')
  if (enabled !== true) issues.push('unavailable')
  if (data.agent_binding?.agent_id && !overview) issues.push('detailUnavailable')
  if (overview && !overview.asset.enabled) issues.push('disabled')
  if (
    matchNotSystemVars([data.agent_task ?? '']).some(
      (selector) => !resolveExternalAgentTaskVariable(selector, availableVars),
    )
  )
    issues.push('invalidVariable')
  if (
    hasUnsupportedExternalOutputs(data.agent_declared_outputs) ||
    data.retry_config?.retry_enabled ||
    data.default_value?.some((value) => {
      const output = (
        data.agent_declared_outputs?.length
          ? data.agent_declared_outputs
          : externalAgentDefaultOutputs
      ).find((output) => output.name === value.key)
      return !output || containsExternalFileOutput(output)
    })
  )
    issues.push('outputUnsupported')
  return {
    issues,
    variableIssues: overview
      ? getExternalAgentTaskVariableIssues(
          overview.inputModes,
          data.agent_task ?? '',
          availableVars,
          fileModes,
        )
      : [],
  }
}
