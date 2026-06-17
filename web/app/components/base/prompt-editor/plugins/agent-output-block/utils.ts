import type { DeclaredOutputConfig, DeclaredOutputType } from '@dify/contracts/api/console/apps/types.gen'

export type AgentOutputTypeOptionValue
  = DeclaredOutputType
    | 'array[boolean]'
    | 'array[file]'
    | 'array[number]'
    | 'array[object]'
    | 'array[string]'

export type AgentOutputTypeOption = {
  label: string
  type: DeclaredOutputType
  value: AgentOutputTypeOptionValue
  arrayItemType?: DeclaredOutputType
}

export const AGENT_OUTPUT_TOKEN_REGEX = /\[§output:([A-Za-z_]\w*):([A-Za-z_]\w*)§\]/
export const LEGACY_AGENT_OUTPUT_TOKEN_REGEX = /§output:([A-Za-z_]\w*):([A-Za-z_]\w*)§/
export const AGENT_OUTPUT_NAME_PATTERN = /^[a-z_]\w*$/i

export function getAgentOutputToken(name: string) {
  return `[§output:${name}:${name}§]`
}

export function parseAgentOutputToken(text: string) {
  const match = AGENT_OUTPUT_TOKEN_REGEX.exec(text) ?? LEGACY_AGENT_OUTPUT_TOKEN_REGEX.exec(text)
  if (!match)
    return null

  return {
    name: match[1]!,
    start: match.index,
    end: match.index + match[0].length,
  }
}

export const AGENT_OUTPUT_TYPE_OPTIONS: AgentOutputTypeOption[] = [
  { value: 'string', label: 'string', type: 'string' },
  { value: 'number', label: 'number', type: 'number' },
  { value: 'boolean', label: 'boolean', type: 'boolean' },
  { value: 'object', label: 'object', type: 'object' },
  { value: 'file', label: 'file', type: 'file' },
  { value: 'array[string]', label: 'array[string]', type: 'array', arrayItemType: 'string' },
  { value: 'array[number]', label: 'array[number]', type: 'array', arrayItemType: 'number' },
  { value: 'array[boolean]', label: 'array[boolean]', type: 'array', arrayItemType: 'boolean' },
  { value: 'array[object]', label: 'array[object]', type: 'array', arrayItemType: 'object' },
  { value: 'array[file]', label: 'array[file]', type: 'array', arrayItemType: 'file' },
]

export function getAgentOutputTypeOption(value: AgentOutputTypeOptionValue) {
  return AGENT_OUTPUT_TYPE_OPTIONS.find(option => option.value === value) || AGENT_OUTPUT_TYPE_OPTIONS[0]!
}

export function getAgentOutputTypeOptionValue(output: DeclaredOutputConfig): AgentOutputTypeOptionValue {
  if (output.type !== 'array')
    return output.type

  return `array[${output.array_item?.type || 'object'}]` as AgentOutputTypeOptionValue
}

export function createAgentOutputConfig(name: string, type: AgentOutputTypeOptionValue): DeclaredOutputConfig {
  const option = getAgentOutputTypeOption(type)
  const output: DeclaredOutputConfig = {
    name: name.trim(),
    type: option.type,
    required: false,
  }

  if (option.type === 'array') {
    output.array_item = {
      type: option.arrayItemType || 'object',
    }
  }

  if (option.type === 'file') {
    output.file = {
      extensions: [],
      mime_types: [],
    }
  }

  return output
}

export function getUniqueAgentOutputName(outputs: DeclaredOutputConfig[]) {
  const outputNames = new Set(outputs.map(output => output.name))
  const baseName = 'output'
  if (!outputNames.has(baseName))
    return baseName

  let index = 1
  while (outputNames.has(`${baseName}_${index}`))
    index += 1

  return `${baseName}_${index}`
}
