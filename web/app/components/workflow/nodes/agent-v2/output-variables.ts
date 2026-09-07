import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { AgentV2NodeType } from './types'
import type { Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'

export const agentV2SystemTextOutput: DeclaredOutputConfig = Object.freeze({
  name: 'text',
  type: 'string',
  required: false,
  description: 'Free-form text answer.',
})

export const AGENT_V2_RESERVED_OUTPUT_NAMES: ReadonlySet<string> = new Set([
  'text',
  'switch',
  '_session',
])

const outputTypeLabels: Record<DeclaredOutputConfig['type'], string> = {
  array: 'Array',
  boolean: 'Boolean',
  file: 'File',
  number: 'Number',
  object: 'Object',
  string: 'String',
}

const outputVarTypes: Record<DeclaredOutputConfig['type'], VarType> = {
  array: VarType.array,
  boolean: VarType.boolean,
  file: VarType.file,
  number: VarType.number,
  object: VarType.object,
  string: VarType.string,
}

const arrayItemVarTypes: Record<DeclaredOutputConfig['type'], VarType> = {
  array: VarType.array,
  boolean: VarType.arrayBoolean,
  file: VarType.arrayFile,
  number: VarType.arrayNumber,
  object: VarType.arrayObject,
  string: VarType.arrayString,
}

export function getAgentV2DeclaredOutputs(data: AgentV2NodeType) {
  return normalizeAgentV2DeclaredOutputs(data.agent_declared_outputs ?? [])
}

export function getAgentV2CustomDeclaredOutputs(outputs: readonly DeclaredOutputConfig[]) {
  return outputs.filter((output) => !AGENT_V2_RESERVED_OUTPUT_NAMES.has(output.name))
}

export function normalizeAgentV2DeclaredOutputs(outputs: readonly DeclaredOutputConfig[]) {
  return [agentV2SystemTextOutput, ...getAgentV2CustomDeclaredOutputs(outputs)]
}

/**
 * @public
 */
// TODO: Remove this marker after the output type label consumer is wired.
export function getDeclaredOutputTypeLabel(output: DeclaredOutputConfig) {
  if (output.type === 'array')
    return `Array[${output.array_item ? outputTypeLabels[output.array_item.type] : 'Object'}]`

  return outputTypeLabels[output.type]
}

function getDeclaredOutputVarType(output: DeclaredOutputConfig) {
  if (output.type === 'array')
    return output.array_item ? arrayItemVarTypes[output.array_item.type] : VarType.arrayObject

  return outputVarTypes[output.type]
}

export function getAgentV2OutputVars(data: AgentV2NodeType): Var[] {
  return getAgentV2DeclaredOutputs(data).map((output) => ({
    variable: output.name,
    type: getDeclaredOutputVarType(output),
  }))
}
