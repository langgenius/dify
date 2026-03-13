/**
 * Utility functions for form data handling in trigger plugin components
 */

/**
 * Sanitizes form values by converting null/undefined to empty strings
 * This ensures React form inputs don't receive null values which can cause warnings
 */
export const sanitizeFormValues = (values: Record<string, any>): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value === null || value === undefined ? '' : String(value),
    ]),
  )
}

/**
 * Deep sanitizes form values while preserving nested objects structure
 * Useful for complex form schemas with nested properties
 */
export const deepSanitizeFormValues = (values: Record<string, any>, visited = new WeakSet()): Record<string, any> => {
  if (visited.has(values))
    return {}

  visited.add(values)

  const result: Record<string, any> = {}

  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined)
      result[key] = ''
    else if (typeof value === 'object' && !Array.isArray(value))
      result[key] = deepSanitizeFormValues(value, visited)
    else
      result[key] = value
  }

  return result
}

/**
 * Validates required fields in form data
 * Returns the first missing required field or null if all are present
 */
export const findMissingRequiredField = (
  formData: Record<string, any>,
  requiredFields: Array<{ name: string, label: any }>,
): { name: string, label: any } | null => {
  for (const field of requiredFields) {
    if (!formData[field.name] || formData[field.name] === '')
      return field
  }
  return null
}
