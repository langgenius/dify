// GENERATE BY script
// DON NOT EDIT IT MANUALLY
//
// This script fetches the docs.json from dify-docs repository
// and generates TypeScript types for documentation paths.
//
// Usage: pnpm gen-doc-paths

import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCS_JSON_URL = 'https://raw.githubusercontent.com/langgenius/dify-docs/refs/heads/main/docs.json'
const OUTPUT_PATH = path.resolve(__dirname, '../types/doc-paths.ts')

type NavItem = string | NavObject | NavItem[]

type NavObject = {
  pages?: NavItem[]
  groups?: NavItem[]
  dropdowns?: NavItem[]
  languages?: NavItem[]
  versions?: NavItem[]
  openapi?: string
  [key: string]: unknown
}

type OpenAPIOperation = {
  summary?: string
  operationId?: string
  tags?: string[]
  [key: string]: unknown
}

type OpenAPIPathItem = {
  get?: OpenAPIOperation
  post?: OpenAPIOperation
  put?: OpenAPIOperation
  patch?: OpenAPIOperation
  delete?: OpenAPIOperation
  [key: string]: unknown
}

type OpenAPISpec = {
  paths?: Record<string, OpenAPIPathItem>
  [key: string]: unknown
}

type Redirect = {
  source: string
  destination: string
}

type DocsJson = {
  navigation?: NavItem
  redirects?: Redirect[]
  [key: string]: unknown
}

const OPENAPI_BASE_URL = 'https://raw.githubusercontent.com/langgenius/dify-docs/refs/heads/main/'

/**
 * Convert summary to URL slug
 * e.g., "Get Knowledge Base List" -> "get-knowledge-base-list"
 * e.g., "获取知识库列表" -> "获取知识库列表"
 */
function summaryToSlug(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Get the first path segment from an API path
 * e.g., "/datasets/{dataset_id}/documents" -> "datasets"
 */
function getFirstPathSegment(apiPath: string): string {
  const segments = apiPath.split('/').filter(Boolean)
  return segments[0] || ''
}

/**
 * Recursively extract OpenAPI file paths from navigation structure
 */
function extractOpenAPIPaths(item: NavItem | undefined, paths: Set<string> = new Set()): Set<string> {
  if (!item)
    return paths

  if (Array.isArray(item)) {
    for (const el of item)
      extractOpenAPIPaths(el, paths)

    return paths
  }

  if (typeof item === 'object') {
    if (item.openapi && typeof item.openapi === 'string')
      paths.add(item.openapi)

    if (item.pages)
      extractOpenAPIPaths(item.pages, paths)

    if (item.groups)
      extractOpenAPIPaths(item.groups, paths)

    if (item.dropdowns)
      extractOpenAPIPaths(item.dropdowns, paths)

    if (item.languages)
      extractOpenAPIPaths(item.languages, paths)

    if (item.versions)
      extractOpenAPIPaths(item.versions, paths)
  }

  return paths
}

type EndpointPathMap = Map<string, string> // key: `${apiPath}_${method}`, value: generated doc path

/**
 * Fetch and parse OpenAPI spec, extract API reference paths with endpoint keys
 */
async function fetchOpenAPIAndExtractPaths(openapiPath: string): Promise<EndpointPathMap> {
  const url = `${OPENAPI_BASE_URL}${openapiPath}`
  const response = await fetch(url)
  if (!response.ok) {
    console.warn(`Failed to fetch ${url}: ${response.status}`)
    return new Map()
  }

  const spec = await response.json() as OpenAPISpec
  const pathMap: EndpointPathMap = new Map()

  if (!spec.paths)
    return pathMap

  const httpMethods = ['get', 'post', 'put', 'patch', 'delete'] as const

  for (const [apiPath, pathItem] of Object.entries(spec.paths)) {
    for (const method of httpMethods) {
      const operation = pathItem[method]
      if (operation?.summary) {
        // Try to get tag from operation, fallback to path segment
        const tag = operation.tags?.[0]
        const segment = tag ? summaryToSlug(tag) : getFirstPathSegment(apiPath)
        if (!segment)
          continue

        const slug = summaryToSlug(operation.summary)
        // Skip empty slugs
        if (slug) {
          const endpointKey = `${apiPath}_${method}`
          pathMap.set(endpointKey, `/api-reference/${segment}/${slug}`)
        }
      }
    }
  }

  return pathMap
}

/**
 * Recursively extract all page paths from navigation structure
 */
function extractPaths(item: NavItem | undefined, paths: Set<string> = new Set()): Set<string> {
  if (!item)
    return paths

  if (Array.isArray(item)) {
    for (const el of item)
      extractPaths(el, paths)

    return paths
  }

  if (typeof item === 'string') {
    paths.add(item)
    return paths
  }

  if (typeof item === 'object') {
    // Handle pages array
    if (item.pages)
      extractPaths(item.pages, paths)

    // Handle groups array
    if (item.groups)
      extractPaths(item.groups, paths)

    // Handle dropdowns
    if (item.dropdowns)
      extractPaths(item.dropdowns, paths)

    // Handle languages
    if (item.languages)
      extractPaths(item.languages, paths)

    // Handle versions in navigation
    if (item.versions)
      extractPaths(item.versions, paths)
  }

  return paths
}

/**
 * Group paths by their prefix structure
 */
function groupPathsBySection(paths: Set<string>): Record<string, Set<string>> {
  const groups: Record<string, Set<string>> = {}

  for (const fullPath of paths) {
    // Skip non-doc paths (like .json files for OpenAPI)
    if (fullPath.endsWith('.json'))
      continue

    // Remove language prefix (en/, zh/, ja/)
    const withoutLang = fullPath.replace(/^(en|zh|ja)\//, '')
    if (!withoutLang || withoutLang === fullPath)
      continue

    // Get section (first part of path)
    const parts = withoutLang.split('/')
    const section = parts[0]

    if (!groups[section])
      groups[section] = new Set()

    groups[section].add(withoutLang)
  }

  return groups
}

/**
 * Convert section name to TypeScript type name
 */
function sectionToTypeName(section: string): string {
  return section
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/**
 * Generate TypeScript type definitions
 */
function generateTypeDefinitions(
  groups: Record<string, Set<string>>,
  apiReferencePaths: string[],
  apiPathTranslations: Record<string, { zh?: string, ja?: string }>,
): string {
  const lines: string[] = [
    '// GENERATE BY script',
    '// DON NOT EDIT IT MANUALLY',
    '//',
    '// Generated from: https://raw.githubusercontent.com/langgenius/dify-docs/refs/heads/main/docs.json',
    `// Generated at: ${new Date().toISOString()}`,
    '',
    '// Language prefixes',
    'export type DocLanguage = \'en\' | \'zh\' | \'ja\'',
    '',
  ]

  const typeNames: string[] = []

  // Generate type for each section
  for (const [section, pathsSet] of Object.entries(groups)) {
    const paths = Array.from(pathsSet).sort()
    const typeName = `${sectionToTypeName(section)}Path`
    typeNames.push(typeName)

    lines.push(`// ${sectionToTypeName(section)} paths`)
    lines.push(`export type ${typeName} =`)

    for (const p of paths) {
      lines.push(`  | '/${p}'`)
    }

    lines.push('')
  }

  // Generate API reference type (English paths only)
  if (apiReferencePaths.length > 0) {
    const sortedPaths = [...apiReferencePaths].sort()
    lines.push('// API Reference paths (English, use apiReferencePathTranslations for other languages)')
    lines.push('export type ApiReferencePath =')
    for (const p of sortedPaths) {
      lines.push(`  | '${p}'`)
    }
    lines.push('')
    typeNames.push('ApiReferencePath')
  }

  // Generate base combined type
  lines.push('// Base path without language prefix')
  lines.push('export type DocPathWithoutLangBase =')
  for (const typeName of typeNames) {
    lines.push(`  | ${typeName}`)
  }
  lines.push('')

  // Generate combined type with optional anchor support
  lines.push('// Combined path without language prefix (supports optional #anchor)')
  lines.push('export type DocPathWithoutLang =')
  lines.push('  | DocPathWithoutLangBase')
  // eslint-disable-next-line no-template-curly-in-string
  lines.push('  | `${DocPathWithoutLangBase}#${string}`')
  lines.push('')

  // Generate full path type with language prefix
  lines.push('// Full documentation path with language prefix')
  // eslint-disable-next-line no-template-curly-in-string
  lines.push('export type DifyDocPath = `${DocLanguage}/${DocPathWithoutLang}`')
  lines.push('')

  // Generate API reference path translations map
  lines.push('// API Reference path translations (English -> other languages)')
  lines.push('export const apiReferencePathTranslations: Record<string, { zh?: string; ja?: string }> = {')
  const sortedEnPaths = Object.keys(apiPathTranslations).sort()
  for (const enPath of sortedEnPaths) {
    const translations = apiPathTranslations[enPath]
    const parts: string[] = []
    if (translations.zh)
      parts.push(`zh: '${translations.zh}'`)
    if (translations.ja)
      parts.push(`ja: '${translations.ja}'`)
    if (parts.length > 0)
      lines.push(`  '${enPath}': { ${parts.join(', ')} },`)
  }
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

async function main(): Promise<void> {
  console.log('Fetching docs.json from GitHub...')

  const response = await fetch(DOCS_JSON_URL)
  if (!response.ok)
    throw new Error(`Failed to fetch docs.json: ${response.status} ${response.statusText}`)

  const docsJson = await response.json() as DocsJson
  console.log('Successfully fetched docs.json')

  // Extract paths from navigation
  const allPaths = extractPaths(docsJson.navigation)

  console.log(`Found ${allPaths.size} total paths`)

  // Extract OpenAPI file paths from navigation for all languages
  const openApiPaths = extractOpenAPIPaths(docsJson.navigation)

  console.log(`Found ${openApiPaths.size} OpenAPI specs to process`)

  // Fetch OpenAPI specs and extract API reference paths with endpoint keys
  // Group by OpenAPI file name (without language prefix) to match endpoints across languages
  const endpointMapsByLang: Record<string, Map<string, EndpointPathMap>> = {
    en: new Map(),
    zh: new Map(),
    ja: new Map(),
  }

  for (const openapiPath of openApiPaths) {
    // Determine language from path
    const langMatch = openapiPath.match(/^(en|zh|ja)\//)
    if (!langMatch)
      continue

    const lang = langMatch[1]
    // Get file name without language prefix (e.g., "api-reference/openapi_knowledge.json")
    const fileKey = openapiPath.replace(/^(en|zh|ja)\//, '')

    console.log(`Fetching OpenAPI spec: ${openapiPath}`)
    const pathMap = await fetchOpenAPIAndExtractPaths(openapiPath)
    endpointMapsByLang[lang].set(fileKey, pathMap)
  }

  // Build English paths and mapping to other languages
  const enApiPaths: string[] = []
  const apiPathTranslations: Record<string, { zh?: string, ja?: string }> = {}

  // Iterate through English endpoint maps
  for (const [fileKey, enPathMap] of endpointMapsByLang.en) {
    const zhPathMap = endpointMapsByLang.zh.get(fileKey)
    const jaPathMap = endpointMapsByLang.ja.get(fileKey)

    for (const [endpointKey, enPath] of enPathMap) {
      enApiPaths.push(enPath)

      const zhPath = zhPathMap?.get(endpointKey)
      const jaPath = jaPathMap?.get(endpointKey)

      if (zhPath || jaPath) {
        apiPathTranslations[enPath] = {}
        if (zhPath)
          apiPathTranslations[enPath].zh = zhPath
        if (jaPath)
          apiPathTranslations[enPath].ja = jaPath
      }
    }
  }

  // Deduplicate English API paths
  const uniqueEnApiPaths = [...new Set(enApiPaths)]

  console.log(`Extracted ${uniqueEnApiPaths.length} unique English API reference paths`)

  console.log(`Generated ${Object.keys(apiPathTranslations).length} API path translations`)

  // Group by section
  const groups = groupPathsBySection(allPaths)

  console.log(`Grouped into ${Object.keys(groups).length} sections:`, Object.keys(groups))

  // Generate TypeScript
  const tsContent = generateTypeDefinitions(groups, uniqueEnApiPaths, apiPathTranslations)

  // Write to file
  await writeFile(OUTPUT_PATH, tsContent, 'utf-8')

  console.log(`Generated TypeScript types at: ${OUTPUT_PATH}`)
}

main().catch((err: Error) => {
  console.error('Error:', err.message)
  process.exit(1)
})
