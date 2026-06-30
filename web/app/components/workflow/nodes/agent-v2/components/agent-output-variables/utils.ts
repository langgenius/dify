import type { DeclaredOutputConfig, DeclaredOutputType } from '@dify/contracts/api/console/apps/types.gen'
import type { TFunction } from 'i18next'
import { defaultAgentV2DeclaredOutputs } from '../../output-variables'

export type OutputTypeOptionValue
  = DeclaredOutputType
    | 'array[boolean]'
    | 'array[file]'
    | 'array[number]'
    | 'array[object]'
    | 'array[string]'

export type OutputTypeOption = {
  label: string
  type: DeclaredOutputType
  value: OutputTypeOptionValue
  arrayItemType?: DeclaredOutputType
}

export type OutputDraft = {
  defaultValue: string
  description: string
  name: string
  required: boolean
  type: OutputTypeOptionValue
}

export type EditingState = {
  draft: OutputDraft
  index?: number
}

export type AgentOutputVariablesProps = {
  outputs: DeclaredOutputConfig[]
  onChange: (outputs: DeclaredOutputConfig[]) => void
}

export const OUTPUT_NAME_PATTERN = /^[a-z_]\w*$/i
export const OUTPUT_NAME_PATTERN_SOURCE = '[A-Za-z_][A-Za-z0-9_]*'

export const OUTPUT_TYPE_OPTIONS: OutputTypeOption[] = [
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

export function getOutputTypeOptionValue(output: DeclaredOutputConfig): OutputTypeOptionValue {
  if (output.type !== 'array')
    return output.type

  return `array[${output.array_item?.type || 'object'}]` as OutputTypeOptionValue
}

export function getOutputTypeOption(value: OutputTypeOptionValue) {
  return OUTPUT_TYPE_OPTIONS.find(option => option.value === value) || OUTPUT_TYPE_OPTIONS[0]!
}

export function createDraft(output?: DeclaredOutputConfig): OutputDraft {
  if (!output) {
    return {
      defaultValue: '',
      description: '',
      name: '',
      required: false,
      type: 'string',
    }
  }

  return {
    defaultValue: getOutputDefaultValue(output),
    description: output.description || '',
    name: output.name,
    required: output.required ?? true,
    type: getOutputTypeOptionValue(output),
  }
}

export function createOutputFromDraft(draft: OutputDraft): DeclaredOutputConfig {
  const option = getOutputTypeOption(draft.type)
  const output: DeclaredOutputConfig = {
    name: draft.name.trim(),
    type: option.type,
    required: draft.required,
  }

  if (draft.description.trim())
    output.description = draft.description.trim()

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

  if (draft.defaultValue.trim()) {
    output.failure_strategy = {
      on_failure: 'default_value',
      default_value: coerceDefaultValue(draft.defaultValue, option),
    }
  }

  return output
}

export function getDefaultValueErrorKey(draft: OutputDraft) {
  const trimmed = draft.defaultValue.trim()
  if (!trimmed)
    return null

  const option = getOutputTypeOption(draft.type)
  if (option.type === 'file' || option.arrayItemType === 'file')
    return 'nodes.agent.outputVars.defaultValueFileUnsupported'

  if (option.type === 'number' && Number.isNaN(Number(trimmed)))
    return 'nodes.agent.outputVars.defaultValueNumberInvalid'

  if (option.type === 'boolean' && trimmed !== 'true' && trimmed !== 'false')
    return 'nodes.agent.outputVars.defaultValueBooleanInvalid'

  if (option.type === 'object' || option.type === 'array') {
    try {
      const parsed = JSON.parse(trimmed)
      if (option.type === 'object' && (!parsed || Array.isArray(parsed) || typeof parsed !== 'object'))
        return 'nodes.agent.outputVars.defaultValueObjectInvalid'
      if (option.type === 'array' && !Array.isArray(parsed))
        return 'nodes.agent.outputVars.defaultValueArrayInvalid'
    }
    catch {
      return option.type === 'object'
        ? 'nodes.agent.outputVars.defaultValueObjectInvalid'
        : 'nodes.agent.outputVars.defaultValueArrayInvalid'
    }
  }

  return null
}

export function isDefaultOutput(output: DeclaredOutputConfig) {
  return defaultAgentV2DeclaredOutputs.some(defaultOutput =>
    defaultOutput.name === output.name
    && defaultOutput.type === output.type
    && getOutputTypeOptionValue(defaultOutput) === getOutputTypeOptionValue(output),
  )
}

export function getOutputDescription(output: DeclaredOutputConfig, t: TFunction) {
  if (output.name === 'text')
    return t('nodes.agent.outputVars.text', { ns: 'workflow' })
  if (output.name === 'files')
    return t('nodes.agent.outputVars.files.title', { ns: 'workflow' })
  if (output.name === 'json')
    return t('nodes.agent.outputVars.json', { ns: 'workflow' })
  return output.description || ''
}

export function getOutputDisplayType(output: DeclaredOutputConfig) {
  return getOutputTypeOption(getOutputTypeOptionValue(output)).label
}

function getOutputDefaultValue(output: DeclaredOutputConfig) {
  const defaultValue = output.failure_strategy?.default_value
  if (defaultValue == null)
    return ''
  if (typeof defaultValue === 'string')
    return defaultValue
  return JSON.stringify(defaultValue)
}

function coerceDefaultValue(value: string, option: OutputTypeOption): unknown {
  const trimmed = value.trim()
  if (option.type === 'number') {
    const parsed = Number(trimmed)
    return Number.isNaN(parsed) ? trimmed : parsed
  }
  if (option.type === 'boolean')
    return trimmed === 'true'
  if (option.type === 'object' || option.type === 'array') {
    try {
      return JSON.parse(trimmed)
    }
    catch {
      return trimmed
    }
  }
  return trimmed
}
