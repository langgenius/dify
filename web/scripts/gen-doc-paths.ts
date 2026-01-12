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
const REDIRECTS_PATH = path.resolve(__dirname, '../eslint-rules/doc-redirects.js')

type NavItem = string | NavObject | NavItem[]

type NavObject = {
  pages?: NavItem[]
  groups?: NavItem[]
  dropdowns?: NavItem[]
  languages?: NavItem[]
  versions?: NavItem[]
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
function generateTypeDefinitions(groups: Record<string, Set<string>>): string {
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
      lines.push(`  | '${p}'`)
    }

    lines.push('')
  }

  // Generate API reference type (for .json files)
  lines.push('// API Reference paths')
  lines.push('export type ApiReferencePath =')
  lines.push('  | \'api-reference/openapi_chat.json\'')
  lines.push('  | \'api-reference/openapi_chatflow.json\'')
  lines.push('  | \'api-reference/openapi_workflow.json\'')
  lines.push('  | \'api-reference/openapi_knowledge.json\'')
  lines.push('  | \'api-reference/openapi_completion.json\'')
  lines.push('')
  typeNames.push('ApiReferencePath')

  // Generate combined type
  lines.push('// Combined path without language prefix')
  lines.push('export type DocPathWithoutLang =')
  for (const typeName of typeNames) {
    lines.push(`  | ${typeName}`)
  }
  lines.push('')

  // Generate full path type with language prefix
  lines.push('// Full documentation path with language prefix')
  // eslint-disable-next-line no-template-curly-in-string
  lines.push('export type DifyDocPath = `${DocLanguage}/${DocPathWithoutLang}`')
  lines.push('')

  return lines.join('\n')
}

/**
 * Generate redirects map for ESLint rule
 * Strips language prefix from paths for use with useDocLink
 */
function generateRedirectsModule(redirects: Redirect[]): string {
  const lines: string[] = [
    '// GENERATE BY script',
    '// DON NOT EDIT IT MANUALLY',
    '//',
    '// Generated from: https://raw.githubusercontent.com/langgenius/dify-docs/refs/heads/main/docs.json',
    `// Generated at: ${new Date().toISOString()}`,
    '',
    '/** @type {Map<string, string>} */',
    'export const docRedirects = new Map([',
  ]

  // Use a map to deduplicate paths (same path in different languages)
  const pathMap = new Map<string, string>()
  const langPrefixRegex = /^\/(en|zh|ja|zh-hans|ja-jp)\//

  for (const redirect of redirects) {
    // Skip wildcard redirects
    if (redirect.source.includes(':slug'))
      continue

    // Strip language prefix from source and destination
    const sourceWithoutLang = redirect.source.replace(langPrefixRegex, '')
    const destWithoutLang = redirect.destination.replace(langPrefixRegex, '')

    // Only add if we haven't seen this path yet
    if (!pathMap.has(sourceWithoutLang))
      pathMap.set(sourceWithoutLang, destWithoutLang)
  }

  for (const [source, dest] of pathMap) {
    lines.push(`  ['${source}', '${dest}'],`)
  }

  lines.push('])')
  lines.push('')

  return lines.join('\n')
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Fetching docs.json from GitHub...')

  const response = await fetch(DOCS_JSON_URL)
  if (!response.ok)
    throw new Error(`Failed to fetch docs.json: ${response.status} ${response.statusText}`)

  const docsJson = await response.json() as DocsJson
  // eslint-disable-next-line no-console
  console.log('Successfully fetched docs.json')

  // Extract paths from navigation
  const allPaths = extractPaths(docsJson.navigation)

  // eslint-disable-next-line no-console
  console.log(`Found ${allPaths.size} total paths`)

  // Group by section
  const groups = groupPathsBySection(allPaths)
  // eslint-disable-next-line no-console
  console.log(`Grouped into ${Object.keys(groups).length} sections:`, Object.keys(groups))

  // Generate TypeScript
  const tsContent = generateTypeDefinitions(groups)

  // Write to file
  await writeFile(OUTPUT_PATH, tsContent, 'utf-8')
  // eslint-disable-next-line no-console
  console.log(`Generated TypeScript types at: ${OUTPUT_PATH}`)

  // Generate redirects module for ESLint rule
  const redirects = docsJson.redirects || []
  const redirectsContent = generateRedirectsModule(redirects)
  await writeFile(REDIRECTS_PATH, redirectsContent, 'utf-8')
  // eslint-disable-next-line no-console
  console.log(`Generated redirects module at: ${REDIRECTS_PATH} (${redirects.length} redirects)`)
}

main().catch((err: Error) => {
  console.error('Error:', err.message)
  process.exit(1)
})
