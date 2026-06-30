import type { DeclaredOutputConfig, DeclaredOutputType } from '@dify/contracts/api/console/apps/types.gen'
import type { TFunction } from 'i18next'
import { defaultAgentV2DeclaredOutputs } from '../../output-variables'

export type DeclaredOutputChildConfig = NonNullable<DeclaredOutputConfig['children']>[number]

export type EditableOutputConfig = DeclaredOutputConfig | DeclaredOutputChildConfig

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
  children: DeclaredOutputChildConfig[]
}

export type EditingState = {
  draft: OutputDraft
  outputIndex?: number
  childPath?: number[]
  parentPath?: number[]
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

export function getOutputTypeOptionValue(output: EditableOutputConfig): OutputTypeOptionValue {
  if (output.type !== 'array')
    return output.type

  return `array[${output.array_item?.type || 'object'}]` as OutputTypeOptionValue
}

export function getOutputTypeOption(value: OutputTypeOptionValue) {
  return OUTPUT_TYPE_OPTIONS.find(option => option.value === value) || OUTPUT_TYPE_OPTIONS[0]!
}

export function createDraft(output?: EditableOutputConfig): OutputDraft {
  if (!output) {
    return {
      defaultValue: '',
      description: '',
      name: '',
      required: false,
      type: 'string',
      children: [],
    }
  }

  return {
    defaultValue: getOutputDefaultValue(output),
    description: output.description || '',
    name: output.name,
    required: output.required ?? true,
    type: getOutputTypeOptionValue(output),
    children: getOutputChildren(output),
  }
}

export function createOutputFromDraft(
  draft: OutputDraft,
  { includeDefaultValue = true }: { includeDefaultValue?: boolean } = {},
): DeclaredOutputConfig {
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

  if (draft.children.length && draft.type === 'object')
    output.children = draft.children

  if (draft.children.length && draft.type === 'array[object]') {
    output.array_item = {
      type: 'object',
      children: draft.children,
    }
  }

  if (option.type === 'file') {
    output.file = {
      extensions: [],
      mime_types: [],
    }
  }

  if (includeDefaultValue && draft.defaultValue.trim()) {
    output.failure_strategy = {
      on_failure: 'default_value',
      default_value: coerceDefaultValue(draft.defaultValue, option),
    }
  }

  return output
}

export function toDeclaredOutputChild(output: DeclaredOutputConfig): DeclaredOutputChildConfig {
  return {
    name: output.name,
    type: output.type,
    required: output.required,
    ...(output.description ? { description: output.description } : {}),
    ...(output.file ? { file: output.file } : {}),
    ...(output.children ? { children: output.children } : {}),
    ...(output.array_item ? { array_item: output.array_item } : {}),
  }
}

export function getOutputChildren(output: EditableOutputConfig): DeclaredOutputChildConfig[] {
  if (getOutputTypeOptionValue(output) === 'array[object]')
    return readOutputChildren(output.array_item?.children)

  if (output.type === 'object')
    return readOutputChildren(output.children)

  return []
}

export function canOutputHaveChildren(output: EditableOutputConfig) {
  const type = getOutputTypeOptionValue(output)
  return type === 'object' || type === 'array[object]'
}

function updateOutputChildren(
  output: DeclaredOutputConfig,
  children: DeclaredOutputChildConfig[],
): DeclaredOutputConfig {
  if (getOutputTypeOptionValue(output) === 'array[object]') {
    return {
      ...output,
      array_item: {
        type: 'object',
        ...output.array_item,
        children: children.length ? children : undefined,
      },
    }
  }

  if (output.type === 'object') {
    return {
      ...output,
      children: children.length ? children : undefined,
    }
  }

  return output
}

export function getOutputChildrenAtPath(
  output: DeclaredOutputConfig,
  path: number[],
): DeclaredOutputChildConfig[] {
  const target = getOutputChildAtPath(output, path)
  return target ? getOutputChildren(target) : getOutputChildren(output)
}

function getOutputChildAtPath(
  output: DeclaredOutputConfig,
  path: number[],
): DeclaredOutputChildConfig | undefined {
  let current: DeclaredOutputChildConfig | undefined
  let children = getOutputChildren(output)
  for (const index of path) {
    current = children[index]
    if (!current)
      return undefined
    children = getOutputChildren(current)
  }

  return current
}

export function insertOutputChildAtPath(
  output: DeclaredOutputConfig,
  parentPath: number[],
  child: DeclaredOutputChildConfig,
) {
  return updateOutputChildrenAtPath(output, parentPath, children => [...children, child])
}

export function updateOutputChildAtPath(
  output: DeclaredOutputConfig,
  childPath: number[],
  child: DeclaredOutputChildConfig,
) {
  const childIndex = childPath.at(-1)
  if (childIndex == null)
    return output

  return updateOutputChildrenAtPath(output, childPath.slice(0, -1), children => children.map((item, index) => index === childIndex ? child : item))
}

export function deleteOutputChildAtPath(
  output: DeclaredOutputConfig,
  childPath: number[],
) {
  const childIndex = childPath.at(-1)
  if (childIndex == null)
    return output

  return updateOutputChildrenAtPath(output, childPath.slice(0, -1), children => children.filter((_, index) => index !== childIndex))
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

export function getOutputDescription(output: EditableOutputConfig, t: TFunction) {
  if (output.name === 'text')
    return t('nodes.agent.outputVars.text', { ns: 'workflow' })
  if (output.name === 'files')
    return t('nodes.agent.outputVars.files.title', { ns: 'workflow' })
  if (output.name === 'json')
    return t('nodes.agent.outputVars.json', { ns: 'workflow' })
  return output.description || ''
}

export function getOutputDisplayType(output: EditableOutputConfig) {
  return getOutputTypeOption(getOutputTypeOptionValue(output)).label
}

function readOutputChildren(children: EditableOutputConfig['children']) {
  return (children ?? []) as DeclaredOutputChildConfig[]
}

function updateOutputChildrenAtPath(
  output: DeclaredOutputConfig,
  parentPath: number[],
  updater: (children: DeclaredOutputChildConfig[]) => DeclaredOutputChildConfig[],
): DeclaredOutputConfig {
  if (!parentPath.length)
    return updateOutputChildren(output, updater(getOutputChildren(output)))

  const [childIndex, ...restPath] = parentPath
  if (childIndex == null)
    return output

  const children = getOutputChildren(output)
  const nextChildren = children.map((child, index) => (
    index === childIndex ? updateChildChildrenAtPath(child, restPath, updater) : child
  ))

  return updateOutputChildren(output, nextChildren)
}

function updateChildChildrenAtPath(
  child: DeclaredOutputChildConfig,
  parentPath: number[],
  updater: (children: DeclaredOutputChildConfig[]) => DeclaredOutputChildConfig[],
): DeclaredOutputChildConfig {
  if (!parentPath.length)
    return updateChildChildren(child, updater(getOutputChildren(child)))

  const [childIndex, ...restPath] = parentPath
  if (childIndex == null)
    return child

  const children = getOutputChildren(child)
  const nextChildren = children.map((nestedChild, index) => (
    index === childIndex ? updateChildChildrenAtPath(nestedChild, restPath, updater) : nestedChild
  ))

  return updateChildChildren(child, nextChildren)
}

function updateChildChildren(
  child: DeclaredOutputChildConfig,
  children: DeclaredOutputChildConfig[],
): DeclaredOutputChildConfig {
  if (getOutputTypeOptionValue(child) === 'array[object]') {
    return {
      ...child,
      array_item: {
        type: 'object',
        ...child.array_item,
        children: children.length ? children : undefined,
      },
    }
  }

  if (child.type === 'object') {
    return {
      ...child,
      children: children.length ? children : undefined,
    }
  }

  return child
}

function getOutputDefaultValue(output: EditableOutputConfig) {
  if (!('failure_strategy' in output))
    return ''

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
