const COMPONENT_TYPE_COVERAGE_EXCLUDE_BASENAMES = new Set([
  'type',
  'types',
  'declarations',
])

const TS_TSX_FILE_PATTERN = /\.(?:ts|tsx)$/

export const COMPONENT_TYPE_COVERAGE_EXCLUDE_GLOBS = [
  'app/components/**/type.{ts,tsx}',
  'app/components/**/types.{ts,tsx}',
  'app/components/**/declarations.{ts,tsx}',
]

export const COMPONENT_TYPE_COVERAGE_EXCLUDE_LABEL = 'type.ts[x], types.ts[x], declarations.ts[x]'

export function isTypeCoverageExcludedComponentFile(filePath) {
  if (!filePath)
    return false

  const normalizedPath = filePath.replace(/\\/g, '/')
  const fileName = normalizedPath.split('/').pop() ?? ''
  if (!TS_TSX_FILE_PATTERN.test(fileName))
    return false

  const baseName = fileName.replace(TS_TSX_FILE_PATTERN, '')
  return COMPONENT_TYPE_COVERAGE_EXCLUDE_BASENAMES.has(baseName)
}
