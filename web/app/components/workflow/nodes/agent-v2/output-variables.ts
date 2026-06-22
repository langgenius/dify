import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { AgentV2NodeType } from './types'
import type { Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'

export const defaultAgentV2DeclaredOutputs: DeclaredOutputConfig[] = [
  {
    name: 'text',
    type: 'string',
    required: false,
    description: 'Free-form text answer.',
  },
  {
    name: 'files',
    type: 'array',
    required: false,
    description: 'Files produced by the agent.',
    array_item: {
      type: 'file',
    },
  },
  {
    name: 'json',
    type: 'object',
    required: false,
    description: 'Free-form JSON object.',
  },
]

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
  return data.agent_declared_outputs?.length
    ? data.agent_declared_outputs
    : defaultAgentV2DeclaredOutputs
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
  return getAgentV2DeclaredOutputs(data).map(output => ({
    variable: output.name,
    type: getDeclaredOutputVarType(output),
  }))
}
