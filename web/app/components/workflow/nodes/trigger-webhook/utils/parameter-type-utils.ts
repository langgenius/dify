import type { ArrayElementType, ParameterType } from '../types'

// Constants for better maintainability and reusability
const BASIC_TYPES = ['string', 'number', 'boolean', 'object', 'file'] as const
const ARRAY_ELEMENT_TYPES = ['string', 'number', 'boolean', 'object'] as const

// Generate all valid parameter types programmatically
const VALID_PARAMETER_TYPES: readonly ParameterType[] = [
  ...BASIC_TYPES,
  ...ARRAY_ELEMENT_TYPES.map(type => `array[${type}]` as const),
] as const

// Type display name mappings
const TYPE_DISPLAY_NAMES: Record<ParameterType, string> = {
  'string': 'String',
  'number': 'Number',
  'boolean': 'Boolean',
  'object': 'Object',
  'file': 'File',
  'array[string]': 'Array[String]',
  'array[number]': 'Array[Number]',
  'array[boolean]': 'Array[Boolean]',
  'array[object]': 'Array[Object]',
} as const

// Content type configurations
const CONTENT_TYPE_CONFIGS = {
  'application/json': {
    supportedTypes: [...BASIC_TYPES.filter(t => t !== 'file'), ...ARRAY_ELEMENT_TYPES.map(t => `array[${t}]` as const)],
    description: 'JSON supports all types including arrays',
  },
  'text/plain': {
    supportedTypes: ['string'] as const,
    description: 'Plain text only supports string',
  },
  'application/x-www-form-urlencoded': {
    supportedTypes: ['string', 'number', 'boolean'] as const,
    description: 'Form data supports basic types',
  },
  'forms': {
    supportedTypes: ['string', 'number', 'boolean'] as const,
    description: 'Form data supports basic types',
  },
  'multipart/form-data': {
    supportedTypes: ['string', 'number', 'boolean', 'file'] as const,
    description: 'Multipart supports basic types plus files',
  },
} as const

/**
 * Type guard to check if a string is a valid parameter type
 */
export const isValidParameterType = (type: string): type is ParameterType => {
  return (VALID_PARAMETER_TYPES as readonly string[]).includes(type)
}

/**
 * Type-safe helper to check if a string is a valid array element type
 */
const isValidArrayElementType = (type: string): type is ArrayElementType => {
  return (ARRAY_ELEMENT_TYPES as readonly string[]).includes(type)
}

/**
 * Type-safe helper to check if a string is a valid basic type
 */
const isValidBasicType = (type: string): type is Exclude<ParameterType, `array[${ArrayElementType}]`> => {
  return (BASIC_TYPES as readonly string[]).includes(type)
}

/**
 * Normalizes parameter type from various input formats to the new type system
 * Handles legacy 'array' type and malformed inputs gracefully
 */
export const normalizeParameterType = (input: string | undefined | null): ParameterType => {
  if (!input || typeof input !== 'string')
    return 'string'

  const trimmed = input.trim().toLowerCase()

  // Handle legacy array type
  if (trimmed === 'array')
    return 'array[string]' // Default to string array for backward compatibility

  // Handle specific array types
  if (trimmed.startsWith('array[') && trimmed.endsWith(']')) {
    const elementType = trimmed.slice(6, -1) // Extract content between 'array[' and ']'

    if (isValidArrayElementType(elementType))
      return `array[${elementType}]`

    // Invalid array element type, default to string array
    return 'array[string]'
  }

  // Handle basic types
  if (isValidBasicType(trimmed))
    return trimmed

  // Fallback to string for unknown types
  return 'string'
}

/**
 * Gets display name for parameter types in UI components
 */
export const getParameterTypeDisplayName = (type: ParameterType): string => {
  return TYPE_DISPLAY_NAMES[type] ?? 'String'
}

// Type validation functions for better reusability
const validators = {
  string: (value: unknown): value is string => typeof value === 'string',
  number: (value: unknown): value is number => typeof value === 'number' && !isNaN(value),
  boolean: (value: unknown): value is boolean => typeof value === 'boolean',
  object: (value: unknown): value is object =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  file: (value: unknown): value is File =>
    value instanceof File || (typeof value === 'object' && value !== null),
} as const

/**
 * Validates array elements based on element type
 */
const validateArrayElements = (value: unknown[], elementType: ArrayElementType): boolean => {
  const validator = validators[elementType]
  return value.every(item => validator(item))
}

/**
 * Validates parameter value against its declared type
 * Provides runtime type checking for webhook parameters
 */
export const validateParameterValue = (value: unknown, type: ParameterType): boolean => {
  // Handle basic types
  if (type in validators) {
    const validator = validators[type as keyof typeof validators]
    return validator ? validator(value) : false
  }

  // Handle array types
  if (type.startsWith('array[') && type.endsWith(']')) {
    if (!Array.isArray(value)) return false

    const elementType = type.slice(6, -1)
    return isValidArrayElementType(elementType) && validateArrayElements(value, elementType)
  }

  return false
}

/**
 * Gets available parameter types based on content type
 * Provides context-aware type filtering for different webhook content types
 */
export const getAvailableParameterTypes = (contentType?: string, isRequestBody = false): ParameterType[] => {
  if (!isRequestBody) {
    // Query parameters and headers are always strings
    return ['string']
  }

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
export const createParameterTypeOptions = (contentType?: string, isRequestBody = false) => {
  const availableTypes = getAvailableParameterTypes(contentType, isRequestBody)

  return availableTypes.map(type => ({
    name: getParameterTypeDisplayName(type),
    value: type,
  }))
}
