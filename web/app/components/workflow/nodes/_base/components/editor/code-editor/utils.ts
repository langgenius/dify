export const serializeCodeEditorValue = (
  value?: string | object,
  isJSONStringifyBeauty?: boolean,
): string => {
  if (value == null) return ''

  if (!isJSONStringifyBeauty) {
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return ''
    }
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return typeof value === 'string' ? value : ''
  }
}
