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
const DEFAULT_DOCS_JSON_URL = 'https://raw.githubusercontent.com/langgenius/dify-docs/refs/heads/main/docs.json'
const DOCS_JSON_URL = process.env.DOCS_JSON_URL || DEFAULT_DOCS_JSON_URL
const OUTPUT_PATH = path.resolve(__dirname, '../types/doc-paths.ts')

type NavItem = string | NavObject | NavItem[]

type NavObject = {
  pages?: NavItem[]
  groups?: NavItem[]
  dropdowns?: NavItem[]
  languages?: NavItem[]
  products?: NavItem[]
  tabs?: NavItem[]
  menu?: NavItem[]
  versions?: NavItem[]
  root?: string
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

type DocsJson = {
  navigation?: NavItem
  [key: string]: unknown
}

const OPENAPI_BASE_URL = (process.env.DOCS_OPENAPI_BASE_URL || new URL('.', DOCS_JSON_URL).toString()).replace(/\/?$/, '/')
const DOCS_PRODUCTS = ['cloud', 'self-host'] as const

type DocsProduct = typeof DOCS_PRODUCTS[number]
type ProductAvailability = Record<string, Set<DocsProduct>>

function isDocsProduct(segment: string): segment is DocsProduct {
  return DOCS_PRODUCTS.includes(segment as DocsProduct)
}

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

    if (item.products)
      extractOpenAPIPaths(item.products, paths)

    if (item.tabs)
      extractOpenAPIPaths(item.tabs, paths)

    if (item.menu)
      extractOpenAPIPaths(item.menu, paths)

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
    if (item.root)
      paths.add(item.root)

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

    if (item.products)
      extractPaths(item.products, paths)

    if (item.tabs)
      extractPaths(item.tabs, paths)

    if (item.menu)
      extractPaths(item.menu, paths)

    // Handle versions in navigation
    if (item.versions)
      extractPaths(item.versions, paths)
  }

  return paths
}

function addPathToGroup(groups: Record<string, Set<string>>, pathWithoutLang: string): void {
  const parts = pathWithoutLang.split('/')
  const section = parts[0]
  if (!section)
    return

  if (!groups[section])
    groups[section] = new Set()

  groups[section]!.add(pathWithoutLang)
}

function getProductPathInfo(pathWithoutLang: string): { product: DocsProduct, pathWithoutProduct: string } | undefined {
  const parts = pathWithoutLang.split('/')
  const [product, ...rest] = parts

  if (!product || !isDocsProduct(product) || rest.length === 0)
    return undefined

  return {
    product,
    pathWithoutProduct: rest.join('/'),
  }
}

/**
 * Group paths by their prefix structure
 */
function groupPathsBySection(paths: Set<string>): { groups: Record<string, Set<string>>, productAvailability: ProductAvailability } {
  const groups: Record<string, Set<string>> = {}
  const productAvailability: ProductAvailability = {}

  for (const fullPath of paths) {
    // Remove language prefix (en/, zh/, ja/)
    const withoutLang = fullPath.replace(/^(en|zh|ja)\//, '')
    if (!withoutLang || withoutLang === fullPath)
      continue

    // Skip non-doc paths (like .json files for OpenAPI)
    if (withoutLang.endsWith('.json') || withoutLang === 'None')
      continue

    addPathToGroup(groups, withoutLang)

    const productPathInfo = getProductPathInfo(withoutLang)
    if (productPathInfo) {
      const productlessPath = productPathInfo.pathWithoutProduct
      const normalizedPath = `/${productlessPath}`

      addPathToGroup(groups, productlessPath)

      if (!productAvailability[normalizedPath])
        productAvailability[normalizedPath] = new Set()

      productAvailability[normalizedPath]!.add(productPathInfo.product)
    }
  }

  return {
    groups,
    productAvailability,
  }
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
  productAvailability: ProductAvailability,
  apiReferencePaths: string[],
): string {
  const lines: string[] = [
    '// GENERATE BY script',
    '// DON NOT EDIT IT MANUALLY',
    '//',
    `// Generated from: ${DOCS_JSON_URL}`,
    `// Generated at: ${new Date().toISOString()}`,
    '',
    '// Language prefixes',
    'export type DocLanguage = \'en\' | \'zh\' | \'ja\'',
    'export type DocsProduct = \'cloud\' | \'self-host\'',
    '',
  ]

  const typeNames: string[] = []

  // Generate type for each section
  for (const [section, pathsSet] of Object.entries(groups)) {
    const paths = Array.from(pathsSet).sort()
    const typeName = `${sectionToTypeName(section)}Path`
    typeNames.push(typeName)

    lines.push(`// ${sectionToTypeName(section)} paths`)
    lines.push(`type ${typeName} =`)

    for (const p of paths) {
      lines.push(`  | '/${p}'`)
    }

    lines.push('')

    // Add UseDifyNodesPath helper type after UseDifyPath
    if (section === 'use-dify') {
      lines.push('// UseDify node paths (without prefix)')
      // eslint-disable-next-line no-template-curly-in-string
      lines.push('type ExtractNodesPath<T> = T extends `/use-dify/nodes/${infer Path}` ? Path : never')
      lines.push('export type UseDifyNodesPath = ExtractNodesPath<UseDifyPath>')
      lines.push('')
    }
  }

  // Generate API reference type (English paths only)
  if (apiReferencePaths.length > 0) {
    const sortedPaths = [...apiReferencePaths].sort()
    lines.push('// API Reference endpoint paths')
    lines.push('type ApiEndpointReferencePath =')
    for (const p of sortedPaths) {
      lines.push(`  | '${p}'`)
    }
    lines.push('')
    typeNames.push('ApiEndpointReferencePath')
  }

  // Generate base combined type
  lines.push('// Base path without language prefix')
  lines.push('type DocPathWithoutLangBase =')
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

  // Generate product availability map for productless runtime links.
  lines.push('// Product availability for productless docs paths')
  lines.push('export const docPathProductAvailability: Record<string, readonly DocsProduct[]> = {')
  for (const path of Object.keys(productAvailability).sort()) {
    const products = [...productAvailability[path]!].sort((a, b) => DOCS_PRODUCTS.indexOf(a) - DOCS_PRODUCTS.indexOf(b))
    lines.push(`  '${path}': [${products.map(product => `'${product}'`).join(', ')}],`)
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

  // Fetch English OpenAPI specs and extract API reference paths.
  // API reference URLs are language-prefixed by useDocLink at runtime.
  const enApiPaths: string[] = []

  for (const openapiPath of openApiPaths) {
    const langMatch = /^(en|zh|ja)\//.exec(openapiPath)
    if (langMatch?.[1] !== 'en')
      continue

    console.log(`Fetching OpenAPI spec: ${openapiPath}`)
    const pathMap = await fetchOpenAPIAndExtractPaths(openapiPath)
    for (const enPath of pathMap.values())
      enApiPaths.push(enPath)
  }

  // Deduplicate English API paths
  const uniqueEnApiPaths = [...new Set(enApiPaths)]

  console.log(`Extracted ${uniqueEnApiPaths.length} unique English API reference paths`)

  // Group by section
  const { groups, productAvailability } = groupPathsBySection(allPaths)

  console.log(`Grouped into ${Object.keys(groups).length} sections:`, Object.keys(groups))
  console.log(`Found ${Object.keys(productAvailability).length} product-aware paths`)

  // Generate TypeScript
  const tsContent = generateTypeDefinitions(
    groups,
    productAvailability,
    uniqueEnApiPaths,
  )

  // Write to file
  await writeFile(OUTPUT_PATH, tsContent, 'utf-8')

  console.log(`Generated TypeScript types at: ${OUTPUT_PATH}`)
}

main().catch((err: Error) => {
  console.error('Error:', err.message)
  process.exit(1)
})
