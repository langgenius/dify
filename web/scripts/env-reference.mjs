import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envSourcePath = path.join(projectRoot, 'env.ts')
const docsRoot = path.join(projectRoot, 'docs')
const jsonOutputPath = path.join(docsRoot, 'frontend-env.reference.json')
const markdownOutputPath = path.join(docsRoot, 'frontend-env.reference.md')

/**
 * @typedef {'client' | 'server'} FrontendEnvRuntime
 * @typedef {'browser-public' | 'server-only'} FrontendEnvVisibility
 * @typedef {'body-dataset' | 'process-env'} FrontendEnvInjectionMode
 *
 * @typedef {{
 *   name: string
 *   accepted_names: string[]
 *   runtime: FrontendEnvRuntime
 *   visibility: FrontendEnvVisibility
 *   type: string
 *   description: string
 *   code_default: string | number | boolean | null
 *   required: boolean
 *   injection_mode: FrontendEnvInjectionMode
 *   dataset_key: string | null
 * }} FrontendEnvVariableReference
 *
 * @typedef {{
 *   schema_version: string
 *   artifact_policy: string
 *   authority: {
 *     kind: string
 *     source_root: string
 *     model: string
 *   }
 *   variables: FrontendEnvVariableReference[]
 * }} FrontendEnvReference
 */

const CLIENT_SCHEMA_START = 'const clientSchema = {'
const CLIENT_SCHEMA_END = '} satisfies ClientSchema'
const SERVER_SCHEMA_START = '  server: {'
const SERVER_SCHEMA_END = '  },\n  client: clientSchema,'
const RUNTIME_ENV_START = '  experimental__runtimeEnv: {'
const RUNTIME_ENV_END = '  },\n  emptyStringAsUndefined: true,'

const COMMENT_START = '/**'
const COMMENT_END = '*/'
const PROPERTY_PATTERN = /^\s*([A-Z][A-Z0-9_]+):\s*(.+),\s*$/
const DATASET_PATTERN = /getRuntimeEnvFromBody\('([^']+)'\)/
const DEFAULT_PATTERN = /\.default\(([^)]*)\)/
const ENUM_PATTERN = /z\.enum\(\[(.+?)\]\)/
const STRING_LITERAL_PATTERN = /^(['"])(.*)\1$/

/**
 * @param {string} source
 * @param {string} startMarker
 * @param {string} endMarker
 */
function extractBlock(source, startMarker, endMarker) {
  const startIndex = source.indexOf(startMarker)
  if (startIndex === -1)
    throw new Error(`Missing start marker: ${startMarker}`)

  const contentStart = startIndex + startMarker.length
  const endIndex = source.indexOf(endMarker, contentStart)
  if (endIndex === -1)
    throw new Error(`Missing end marker: ${endMarker}`)

  return source.slice(contentStart, endIndex)
}

/**
 * @param {string} comment
 */
function normalizeDescription(comment) {
  return comment
    .split('\n')
    .map((line) => {
      const trimmedLine = line.trim()
      if (trimmedLine === '/**' || trimmedLine === '*/')
        return ''

      return trimmedLine
        .replace(/^\/\*\*\s?/, '')
        .replace(/^\*\s?/, '')
        .replace(/\s*\*\/$/, '')
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} block
 */
function parseSchemaEntries(block) {
  /** @type {{ name: string, expression: string, description: string }[]} */
  const entries = []
  const lines = block.split('\n')
  /** @type {string[]} */
  let commentBuffer = []
  let isCollectingComment = false

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine)
      continue

    if (trimmedLine.startsWith(COMMENT_START)) {
      isCollectingComment = true
      commentBuffer = [trimmedLine]
      if (trimmedLine.endsWith(COMMENT_END))
        isCollectingComment = false
      continue
    }

    if (isCollectingComment) {
      commentBuffer.push(trimmedLine)
      if (trimmedLine.endsWith(COMMENT_END))
        isCollectingComment = false
      continue
    }

    const propertyMatch = line.match(PROPERTY_PATTERN)
    if (!propertyMatch)
      continue

    const [, name, expression] = propertyMatch
    entries.push({
      name,
      expression: expression.trim(),
      description: normalizeDescription(commentBuffer.join('\n')),
    })
    commentBuffer = []
  }

  return entries
}

/**
 * @param {string} block
 */
function parseRuntimeDatasetKeys(block) {
  /** @type {Map<string, string>} */
  const datasetKeys = new Map()

  for (const line of block.split('\n')) {
    const propertyMatch = line.match(PROPERTY_PATTERN)
    if (!propertyMatch)
      continue

    const [, name, expression] = propertyMatch
    const datasetMatch = expression.match(DATASET_PATTERN)
    if (datasetMatch)
      datasetKeys.set(name, datasetMatch[1])
  }

  return datasetKeys
}

/**
 * @param {string} literal
 * @returns {string | number | boolean | null}
 */
function parseDefaultLiteral(literal) {
  const trimmedLiteral = literal.trim()
  if (!trimmedLiteral)
    return null
  if (trimmedLiteral === 'true')
    return true
  if (trimmedLiteral === 'false')
    return false
  if (/^-?\d+$/.test(trimmedLiteral))
    return Number(trimmedLiteral)

  const stringMatch = trimmedLiteral.match(STRING_LITERAL_PATTERN)
  if (stringMatch)
    return stringMatch[2]

  return null
}

/**
 * @param {string} expression
 */
function inferType(expression) {
  if (expression.includes('coercedBoolean'))
    return 'boolean'
  if (expression.includes('coercedNumber'))
    return 'integer'

  const enumMatch = expression.match(ENUM_PATTERN)
  if (enumMatch) {
    const values = Array.from(enumMatch[1].matchAll(/'([^']+)'|"([^"]+)"/g))
      .map(match => match[1] || match[2])
    return `literal[${values.map(value => JSON.stringify(value)).join(', ')}]`
  }

  if (expression.includes('z.email(') || expression.includes('z.url(') || expression.includes('z.string('))
    return 'string'

  if (expression.includes('z.literal(')) {
    const literalMatch = expression.match(/z\.literal\(([^)]*)\)/)
    if (literalMatch)
      return `literal[${JSON.stringify(parseDefaultLiteral(literalMatch[1]))}]`
  }

  return 'unknown'
}

/**
 * @param {string} expression
 */
function inferDefault(expression) {
  const defaultMatch = expression.match(DEFAULT_PATTERN)
  if (!defaultMatch)
    return null
  return parseDefaultLiteral(defaultMatch[1])
}

/**
 * @param {string} expression
 */
function inferRequired(expression) {
  return !expression.includes('.optional()') && !expression.includes('.default(')
}

/**
 * @param {ReturnType<typeof parseSchemaEntries>[number]} entry
 * @param {Map<string, string>} datasetKeys
 * @returns {FrontendEnvVariableReference}
 */
function toClientVariable(entry, datasetKeys) {
  return {
    name: entry.name,
    accepted_names: [entry.name],
    runtime: 'client',
    visibility: 'browser-public',
    type: inferType(entry.expression),
    description: entry.description,
    code_default: inferDefault(entry.expression),
    required: inferRequired(entry.expression),
    injection_mode: 'body-dataset',
    dataset_key: datasetKeys.get(entry.name) || null,
  }
}

/**
 * @param {ReturnType<typeof parseSchemaEntries>[number]} entry
 * @returns {FrontendEnvVariableReference}
 */
function toServerVariable(entry) {
  return {
    name: entry.name,
    accepted_names: [entry.name],
    runtime: 'server',
    visibility: 'server-only',
    type: inferType(entry.expression),
    description: entry.description,
    code_default: inferDefault(entry.expression),
    required: inferRequired(entry.expression),
    injection_mode: 'process-env',
    dataset_key: null,
  }
}

/**
 * @param {string | number | boolean | null} value
 */
function renderDefault(value) {
  if (value === null)
    return '`""`'
  return `\`${JSON.stringify(value)}\``
}

/**
 * @param {string | null} value
 */
function markdownCodeCell(value) {
  if (!value)
    return ''
  return `\`${String(value).replace(/\|/g, '\\|').replace(/`/g, '\\`')}\``
}

/**
 * @param {string} value
 */
function markdownCell(value) {
  return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

/**
 * @param {FrontendEnvReference} reference
 */
export function renderFrontendEnvReferenceMarkdown(reference) {
  /** @type {Record<FrontendEnvRuntime, FrontendEnvVariableReference[]>} */
  const grouped = {
    client: [],
    server: [],
  }

  for (const variable of reference.variables)
    grouped[variable.runtime].push(variable)

  const lines = [
    '# Frontend Env Reference',
    '',
    '> Generated from `web/env.ts`. Do not edit manually.',
    '',
    'This reference documents frontend application env semantics and code defaults only.',
    'Deploy-time defaults, `.env.example`, Docker files, and runtime-effective values are intentionally excluded.',
    'Only env declared in `web/env.ts` is included. Dev-only tooling env outside that file is excluded.',
    '',
  ]

  for (const runtime of ['client', 'server']) {
    const variables = grouped[/** @type {FrontendEnvRuntime} */ (runtime)]
    if (!variables.length)
      continue

    lines.push(runtime === 'client' ? '## Browser-Public Variables' : '## Server-Only Variables')
    lines.push('')
    lines.push('| Name | Visibility | Type | Default | Injection | Dataset Key | Description |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- |')

    for (const variable of variables) {
      lines.push(
        `| \`${variable.name}\` | ${markdownCodeCell(variable.visibility)} | ${markdownCodeCell(variable.type)} | ${renderDefault(variable.code_default)} | ${markdownCodeCell(variable.injection_mode)} | ${markdownCodeCell(variable.dataset_key)} | ${markdownCell(variable.description)} |`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function buildFrontendEnvReference() {
  const source = readFileSync(envSourcePath, 'utf8')
  const clientEntries = parseSchemaEntries(extractBlock(source, CLIENT_SCHEMA_START, CLIENT_SCHEMA_END))
  const serverEntries = parseSchemaEntries(extractBlock(source, SERVER_SCHEMA_START, SERVER_SCHEMA_END))
  const datasetKeys = parseRuntimeDatasetKeys(extractBlock(source, RUNTIME_ENV_START, RUNTIME_ENV_END))

  return {
    schema_version: '1',
    artifact_policy: 'committed-generated-artifact',
    authority: {
      kind: 'frontend-env-schema',
      source_root: 'web',
      model: 'web/env.ts',
    },
    variables: [
      ...clientEntries.map(entry => toClientVariable(entry, datasetKeys)),
      ...serverEntries.map(toServerVariable),
    ],
  }
}

export function writeFrontendEnvReference() {
  const reference = buildFrontendEnvReference()
  mkdirSync(docsRoot, { recursive: true })
  writeFileSync(jsonOutputPath, `${JSON.stringify(reference, null, 2)}\n`, 'utf8')
  writeFileSync(markdownOutputPath, `${renderFrontendEnvReferenceMarkdown(reference)}\n`, 'utf8')

  return {
    jsonOutputPath,
    markdownOutputPath,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { jsonOutputPath: jsonOutput, markdownOutputPath: markdownOutput } = writeFrontendEnvReference()
  console.log(`Wrote ${path.relative(projectRoot, jsonOutput)}`)
  console.log(`Wrote ${path.relative(projectRoot, markdownOutput)}`)
}
