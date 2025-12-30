let idCounter = 0

export const uniqueId = (prefix = ''): string => {
  idCounter += 1
  return `${prefix}${idCounter}`
}

export const isEmpty = (value: unknown): boolean => {
  if (value == null)
    return true
  if (Array.isArray(value) || typeof value === 'string')
    return value.length === 0
  if (value instanceof Map || value instanceof Set)
    return value.size === 0
  if (typeof value === 'object')
    return Object.keys(value).length === 0
  return false
}
