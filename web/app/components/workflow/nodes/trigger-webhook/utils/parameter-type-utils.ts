import { VarType } from '@/app/components/workflow/types'

// Constants for better maintainability and reusability
const BASIC_TYPES = [VarType.string, VarType.number, VarType.boolean, VarType.object, VarType.file] as const
const ARRAY_ELEMENT_TYPES = [VarType.arrayString, VarType.arrayNumber, VarType.arrayBoolean, VarType.arrayObject] as const

// Generate all valid parameter types programmatically
const VALID_PARAMETER_TYPES: readonly VarType[] = [
  ...BASIC_TYPES,
  ...ARRAY_ELEMENT_TYPES,
] as const

// Type display name mappings
const TYPE_DISPLAY_NAMES: Record<VarType, string> = {
  [VarType.string]: 'String',
  [VarType.number]: 'Number',
  [VarType.boolean]: 'Boolean',
  [VarType.object]: 'Object',
  [VarType.file]: 'File',
  [VarType.arrayString]: 'Array[String]',
  [VarType.arrayNumber]: 'Array[Number]',
  [VarType.arrayBoolean]: 'Array[Boolean]',
  [VarType.arrayObject]: 'Array[Object]',
  [VarType.secret]: 'Secret',
  [VarType.array]: 'Array',
  'array[file]': 'Array[File]',
  [VarType.any]: 'Any',
  'array[any]': 'Array[Any]',
  [VarType.integer]: 'Integer',
} as const

// Content type configurations
const CONTENT_TYPE_CONFIGS = {
  'application/json': {
    supportedTypes: [...BASIC_TYPES.filter(t => t !== 'file'), ...ARRAY_ELEMENT_TYPES],
    description: 'JSON supports all types including arrays',
  },
  'text/plain': {
    supportedTypes: [VarType.string] as const,
    description: 'Plain text only supports string',
  },
  'application/x-www-form-urlencoded': {
    supportedTypes: [VarType.string, VarType.number, VarType.boolean] as const,
    description: 'Form data supports basic types',
  },
  'application/octet-stream': {
    supportedTypes: [VarType.file] as const,
    description: 'octet-stream supports only binary data',
  },
  'multipart/form-data': {
    supportedTypes: [VarType.string, VarType.number, VarType.boolean, VarType.file] as const,
    description: 'Multipart supports basic types plus files',
  },
} as const

/**
 * Type guard to check if a string is a valid parameter type
 */
export const isValidParameterType = (type: string): type is VarType => {
  return (VALID_PARAMETER_TYPES as readonly string[]).includes(type)
}

export const normalizeParameterType = (input: string | undefined | null): VarType => {
  if (!input || typeof input !== 'string')
    return VarType.string

  const trimmed = input.trim().toLowerCase()
  if (trimmed === 'array[string]')
    return VarType.arrayString
  else if (trimmed === 'array[number]')
    return VarType.arrayNumber
  else if (trimmed === 'array[boolean]')
    return VarType.arrayBoolean
  else if (trimmed === 'array[object]')
    return VarType.arrayObject
  else if (trimmed === 'array')
    // Migrate legacy 'array' type to 'array[string]'
    return VarType.arrayString
  else if (trimmed === 'number')
    return VarType.number
  else if (trimmed === 'boolean')
    return VarType.boolean
  else if (trimmed === 'object')
    return VarType.object
  else if (trimmed === 'file')
    return VarType.file

  return VarType.string
}

/**
 * Gets display name for parameter types in UI components
 */
export const getParameterTypeDisplayName = (type: VarType): string => {
  return TYPE_DISPLAY_NAMES[type]
}

/**
 * Gets available parameter types based on content type
 * Provides context-aware type filtering for different webhook content types
 */
export const getAvailableParameterTypes = (contentType?: string): VarType[] => {
  if (!contentType)
    return [VarType.string, VarType.number, VarType.boolean]

  const normalizedContentType = (contentType || '').toLowerCase()
  const configKey = normalizedContentType in CONTENT_TYPE_CONFIGS
    ? normalizedContentType as keyof typeof CONTENT_TYPE_CONFIGS
    : 'application/json'

  const config = CONTENT_TYPE_CONFIGS[configKey]
  return [...config.supportedTypes]
}

/**
 * Creates type options for UI select components
 */
export const createParameterTypeOptions = (contentType?: string) => {
  const availableTypes = getAvailableParameterTypes(contentType)

  return availableTypes.map(type => ({
    name: getParameterTypeDisplayName(type),
    value: type,
  }))
}
