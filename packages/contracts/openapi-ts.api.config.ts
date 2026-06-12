import type { UserConfig } from '@hey-api/openapi-ts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { $, defineConfig } from '@hey-api/openapi-ts'

type JsonObject = Record<string, unknown>

type SwaggerSchema = JsonObject & {
  $ref?: string
  additionalProperties?: unknown
  allOf?: SwaggerSchema[]
  anyOf?: SwaggerSchema[]
  description?: string
  enum?: unknown[]
  items?: SwaggerSchema
  oneOf?: SwaggerSchema[]
  properties?: Record<string, SwaggerSchema>
  required?: string[]
  type?: string
}

type OpenApiMediaType = JsonObject & {
  schema?: SwaggerSchema
}

type OpenApiRequestBody = JsonObject & {
  content?: Record<string, OpenApiMediaType>
  description?: string
  required?: boolean
}

type OpenApiComponents = JsonObject & {
  schemas?: Record<string, SwaggerSchema>
}

type SwaggerParameter = JsonObject & {
  in?: string
  name?: string
  required?: boolean
  schema?: SwaggerSchema
}

type SwaggerResponse = JsonObject & {
  content?: Record<string, OpenApiMediaType>
  description?: string
}

type SwaggerOperation = JsonObject & {
  deprecated?: boolean
  description?: string
  operationId?: string
  parameters?: SwaggerParameter[]
  requestBody?: OpenApiRequestBody | null
  responses?: Record<string, SwaggerResponse>
}

type SwaggerDocument = JsonObject & {
  components?: OpenApiComponents
  openapi?: string
  paths?: Record<string, Record<string, unknown>>
}

type ApiSpec = {
  filename: string
  name: string
}

type ApiJob = {
  clean?: boolean
  document: SwaggerDocument
  outputPath: string
  plugins?: UserConfig['plugins']
  source?: {
    callback: () => void
    enabled: true
    path: null
    serialize: () => string
  }
}

type ApiContractOperation = {
  method: string
  path: string
}

type ApiReadinessSurfaceStats = {
  notReady: number
  total: number
}

type ApiSurface = 'console' | 'service' | 'web'

type ApiOperationContext = {
  method: string
  routePath: string
  runtimeBodyRequired: boolean
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const apiOpenApiDir = path.resolve(currentDir, 'openapi')
const apiControllersDir = path.resolve(currentDir, '../../api/controllers')

const operationMethods = new Set(['delete', 'get', 'patch', 'post', 'put'])
const requestBodyMethods = new Set(['delete', 'patch', 'post', 'put'])
const noBodyResponseStatuses = new Set(['204', '205', '304'])

const apiSpecs: ApiSpec[] = [
  { filename: 'console-openapi.json', name: 'console' },
  { filename: 'web-openapi.json', name: 'web' },
  { filename: 'service-openapi.json', name: 'service' },
  { filename: 'openapi-openapi.json', name: 'openapi' },
]

const inaccurateGeneratedContractDescription = 'Generated contract types may be inaccurate because backend OpenAPI annotations are incomplete. Do not migrate callers until the generated contract is accurate.'
const apiReadinessStats: Record<string, ApiReadinessSurfaceStats> = {}

const isObject = (value: unknown): value is JsonObject => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const unknownObjectSchema = (): SwaggerSchema => ({
  additionalProperties: true,
  type: 'object',
})

const toWords = (value: string) => {
  return value
    .replace(/[{}]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
}

const toPascalCase = (words: string[]) => {
  return words.map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('')
}

const toCamelCase = (words: string[]) => {
  const pascal = toPascalCase(words)
  return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`
}

const toKebabCase = (value: string) => {
  return toWords(value).join('-').toLowerCase()
}

const segmentWords = (segment: string) => {
  if (segment.startsWith('{') && segment.endsWith('}'))
    return ['by', ...toWords(segment)]

  return toWords(segment)
}

const routeWords = (routePath: string) => {
  return routePath
    .split('/')
    .filter(Boolean)
    .flatMap(segmentWords)
}

const operationId = (method: string, routePath: string) => {
  return toCamelCase([method, ...(routeWords(routePath).length > 0 ? routeWords(routePath) : ['root'])])
}

const contractPathSegments = (operation: ApiContractOperation) => {
  const segments = operation.path
    .split('/')
    .filter(Boolean)
    .map(segment => toCamelCase(segmentWords(segment)))

  return [...(segments.length > 0 ? segments : ['root']), operation.method.toLowerCase()]
}

const readApiSwagger = (filename: string): SwaggerDocument => {
  const specPath = path.join(apiOpenApiDir, filename)

  if (!fs.existsSync(specPath)) {
    throw new Error(
      `Missing API OpenAPI spec: ${specPath}. Run "pnpm gen-api-openapi" from packages/contracts/ first.`,
    )
  }

  const rawSpec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
  if (!isObject(rawSpec) || !isObject(rawSpec.paths))
    throw new Error(`Invalid API OpenAPI spec: ${specPath}`)

  return rawSpec as SwaggerDocument
}

const clone = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T
}

const componentSchemaRefPrefix = '#/components/schemas/'

const schemaNameFromRef = (ref: string) => {
  if (ref.startsWith(componentSchemaRefPrefix))
    return ref.slice(componentSchemaRefPrefix.length)
  return undefined
}

const getDocumentSchemas = (document: SwaggerDocument) => {
  const components = document.components ??= {}
  return components.schemas ??= {}
}

const firstContentSchema = (
  content: Record<string, OpenApiMediaType> | undefined,
  preferredMediaTypes: string[],
) => {
  if (!isObject(content))
    return undefined

  for (const mediaType of preferredMediaTypes) {
    const media = content[mediaType]
    if (isObject(media?.schema))
      return media.schema
  }

  for (const media of Object.values(content)) {
    if (isObject(media?.schema))
      return media.schema
  }

  return undefined
}

const getRequestBodySchema = (operation: SwaggerOperation) => {
  return firstContentSchema(operation.requestBody?.content, ['application/json'])
}

const getResponseSchema = (response: SwaggerResponse) => {
  return firstContentSchema(response.content, ['application/json'])
}

const apiOperationKey = (surface: string, method: string, routePath: string) => {
  return `${surface}:${method.toLowerCase()}:${routePath}`
}

// Swagger cannot tell whether an undocumented POST/PATCH/PUT/DELETE body is truly absent or
// just missing @expect(). Scan controllers so readiness stays conservative for those routes.
const listPythonFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory))
    return []

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory())
      return listPythonFiles(entryPath)
    if (entry.isFile() && entry.name.endsWith('.py'))
      return [entryPath]
    return []
  })
}

const leadingWhitespaceLength = (value: string) => {
  return value.length - value.trimStart().length
}

const parenthesesDelta = (value: string) => {
  return [...value].reduce((total, char) => {
    if (char === '(')
      return total + 1
    if (char === ')')
      return total - 1
    return total
  }, 0)
}

const collectDecorator = (lines: string[], startIndex: number) => {
  const decoratorLines = [lines[startIndex] ?? '']
  let index = startIndex
  let balance = parenthesesDelta(decoratorLines[0] ?? '')

  while (balance > 0 && index + 1 < lines.length) {
    index += 1
    const line = lines[index] ?? ''
    decoratorLines.push(line)
    balance += parenthesesDelta(line)
  }

  return {
    decorator: decoratorLines.join('\n'),
    endIndex: index,
  }
}

const routePathFromControllerPath = (controllerPath: string) => {
  return controllerPath
    .replace(/<(?:[^:<>]+:)?([^<>]+)>/g, '{$1}')
    .replace(/\/+/g, '/')
}

const routePathsFromDecorator = (decorator: string) => {
  if (!decorator.includes('.route('))
    return []

  return [...decorator.matchAll(/(['"])(.*?)\1/g)]
    .map(([, , routePath]) => routePath)
    .filter((routePath): routePath is string => typeof routePath === 'string' && routePath.startsWith('/'))
    .map(routePathFromControllerPath)
}

const methodBodyFrom = (lines: string[], methodLineIndex: number, methodIndent: number) => {
  const bodyLines: string[] = []

  for (let index = methodLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() && leadingWhitespaceLength(line) <= methodIndent)
      break

    bodyLines.push(line)
  }

  return bodyLines.join('\n')
}

const usesRuntimeJsonBody = (body: string) => {
  return /\b(?:console_ns|service_api_ns|web_ns)\.payload\b/.test(body)
    || /\brequest\.get_json\s*\(/.test(body)
    || /\brequest\.json\b/.test(body)
}

const collectRuntimeBodyOperationKeysFromFile = (surface: ApiSurface, filePath: string) => {
  const operationKeys = new Set<string>()
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  let pendingDecorators: string[] = []
  let currentRoutes: string[] = []
  let currentClassIndent: number | undefined

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (!trimmed)
      continue

    if (trimmed.startsWith('@')) {
      const { decorator, endIndex } = collectDecorator(lines, index)
      pendingDecorators.push(decorator)
      index = endIndex
      continue
    }

    const indent = leadingWhitespaceLength(line)
    const classMatch = line.match(/^(\s*)class\s+\w+/)
    if (classMatch) {
      currentClassIndent = indent
      currentRoutes = pendingDecorators.flatMap(routePathsFromDecorator)
      pendingDecorators = []
      continue
    }

    if (currentClassIndent !== undefined && indent <= currentClassIndent)
      currentRoutes = []

    const methodMatch = line.match(/^\s*def\s+(delete|get|patch|post|put)\s*\(/)
    if (!methodMatch) {
      pendingDecorators = []
      continue
    }

    pendingDecorators = []

    const method = methodMatch[1]
    if (!method || !requestBodyMethods.has(method))
      continue

    if (currentRoutes.length === 0)
      continue

    const body = methodBodyFrom(lines, index, indent)
    if (!usesRuntimeJsonBody(body))
      continue

    for (const routePath of currentRoutes)
      operationKeys.add(apiOperationKey(surface, method, routePath))
  }

  return operationKeys
}

const collectRuntimeBodyOperationKeys = () => {
  const surfaces = {
    console: path.join(apiControllersDir, 'console'),
    service: path.join(apiControllersDir, 'service_api'),
    web: path.join(apiControllersDir, 'web'),
  } satisfies Record<ApiSurface, string>

  const operationKeys = new Set<string>()

  for (const [surface, directory] of Object.entries(surfaces) as [ApiSurface, string][]) {
    for (const filePath of listPythonFiles(directory)) {
      for (const operationKey of collectRuntimeBodyOperationKeysFromFile(surface, filePath))
        operationKeys.add(operationKey)
    }
  }

  return operationKeys
}

const runtimeBodyOperationKeys = collectRuntimeBodyOperationKeys()

const collectSchemaRefs = (value: unknown, refs: Set<string>, visited = new WeakSet<object>()) => {
  if (!value || typeof value !== 'object')
    return

  if (visited.has(value))
    return

  visited.add(value)

  if (Array.isArray(value)) {
    value.forEach(item => collectSchemaRefs(item, refs, visited))
    return
  }

  const objectValue = value as JsonObject
  const ref = objectValue.$ref
  if (typeof ref === 'string') {
    const refName = schemaNameFromRef(ref)
    if (refName)
      refs.add(refName)
  }

  Object.values(objectValue).forEach(item => collectSchemaRefs(item, refs, visited))
}

const isNullSchema = (schema: SwaggerSchema) => {
  return schema.type === 'null'
}

const withoutNullableWrapper = (schema: SwaggerSchema | undefined): SwaggerSchema => {
  if (!schema)
    return {}

  const nonNullSchema = schema.anyOf?.find(item => item.type !== 'null')
  if (!nonNullSchema)
    return schema

  const { anyOf: _anyOf, ...rest } = schema
  return {
    ...rest,
    ...nonNullSchema,
  }
}

const normalizeResponses = (operation: SwaggerOperation) => {
  const responses = operation.responses ??= {}

  for (const [status, response] of Object.entries(responses)) {
    if (noBodyResponseStatuses.has(status)) {
      delete response.content
      continue
    }

    const schema = getResponseSchema(response) ?? unknownObjectSchema()
    response.content = {
      'application/json': {
        schema,
      },
    }
  }

  if (!Object.keys(responses).some(status => /^2\d\d$/.test(status))) {
    responses['200'] = {
      content: {
        'application/json': {
          schema: unknownObjectSchema(),
        },
      },
      description: 'Success',
    }
  }
}

const hasProperties = (schema: SwaggerSchema) => {
  return isObject(schema.properties) && Object.keys(schema.properties).length > 0
}

const isEmptySchemaObject = (value: unknown) => {
  return isObject(value) && Object.keys(value).length === 0
}

// A field the backend marked deliberately open via the `x-dify-opaque` vendor extension — e.g. a
// JSON Schema document or an app-config blob whose shape is genuinely arbitrary. Such a field is
// intentionally an open object, not an under-annotated one, so the readiness detector must not
// flag it (or its owning operation) as inaccurate.
const isIntentionallyOpaque = (schema: SwaggerSchema) => {
  return (schema as { 'x-dify-opaque'?: unknown })['x-dify-opaque'] === true
}

const isLooseObjectSchema = (schema: SwaggerSchema) => {
  if (hasProperties(schema))
    return false

  if (schema.additionalProperties === true || isEmptySchemaObject(schema.additionalProperties))
    return true

  return schema.type === 'object' && schema.additionalProperties === undefined
}

const hasLooseSchema = (
  schema: SwaggerSchema | undefined,
  schemas: Record<string, SwaggerSchema>,
  visitedRefs = new Set<string>(),
): boolean => {
  if (!schema)
    return true

  if (isIntentionallyOpaque(schema))
    return false

  const ref = schema?.$ref
  if (ref) {
    const refName = schemaNameFromRef(ref)
    if (!refName)
      return false

    if (visitedRefs.has(refName))
      return false

    return hasLooseSchema(schemas[refName], schemas, new Set([...visitedRefs, refName]))
  }

  const normalizedSchema = withoutNullableWrapper(schema)

  for (const variants of [normalizedSchema.allOf, normalizedSchema.anyOf, normalizedSchema.oneOf]) {
    if (Array.isArray(variants) && variants.some(item => !isNullSchema(item) && hasLooseSchema(item, schemas, visitedRefs)))
      return true
  }

  if (normalizedSchema.type === 'array')
    return hasLooseSchema(normalizedSchema.items, schemas, visitedRefs)

  if (isLooseObjectSchema(normalizedSchema))
    return true

  if (isObject(normalizedSchema.additionalProperties) && hasLooseSchema(normalizedSchema.additionalProperties, schemas, visitedRefs))
    return true

  return Object.values(normalizedSchema.properties ?? {})
    .some(property => hasLooseSchema(property, schemas, visitedRefs))
}

const hasPossiblyInaccurateGeneratedContractTypes = (
  operation: SwaggerOperation,
  schemas: Record<string, SwaggerSchema>,
  context: ApiOperationContext,
) => {
  const successResponses = Object.entries(operation.responses ?? {})
    .filter(([status]) => /^2\d\d$/.test(status))

  if (successResponses.length === 0)
    return true

  const successResponsesWithBody = successResponses.filter(([status]) => !noBodyResponseStatuses.has(status))
  if (successResponsesWithBody.some(([, response]) => hasLooseSchema(getResponseSchema(response), schemas)))
    return true

  const requestBodySchema = getRequestBodySchema(operation)
  const legacyBodyParameter = operation.parameters?.find(parameter => parameter.in === 'body')

  if (context.runtimeBodyRequired && !requestBodySchema && !legacyBodyParameter)
    return true

  const bodySchema = requestBodySchema ?? legacyBodyParameter?.schema
  return bodySchema ? hasLooseSchema(bodySchema, schemas) : false
}

const appendOperationDescription = (operation: SwaggerOperation, description: string) => {
  const currentDescription = operation.description?.trim()
  operation.description = currentDescription ? `${currentDescription}\n\n${description}` : description
}

const markPossiblyInaccurateGeneratedContract = (operation: SwaggerOperation) => {
  operation.deprecated = true
  appendOperationDescription(operation, inaccurateGeneratedContractDescription)
}

const recordApiReadiness = (surface: string, isReady: boolean) => {
  const stats = apiReadinessStats[surface] ??= {
    notReady: 0,
    total: 0,
  }

  stats.total += 1

  if (!isReady)
    stats.notReady += 1
}

const formatPercent = (ready: number, total: number) => {
  return total === 0 ? '0.0%' : `${((ready / total) * 100).toFixed(1)}%`
}

const normalizeOperations = (document: SwaggerDocument, surface: string) => {
  const schemas = getDocumentSchemas(document)

  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operationMethods.has(method) || !isObject(operation))
        continue

      const swaggerOperation = operation as SwaggerOperation
      swaggerOperation.operationId = operationId(method, routePath)

      normalizeResponses(swaggerOperation)
      const hasPossiblyInaccurateTypes = hasPossiblyInaccurateGeneratedContractTypes(swaggerOperation, schemas, {
        method,
        routePath,
        runtimeBodyRequired: runtimeBodyOperationKeys.has(apiOperationKey(surface, method, routePath)),
      })
      recordApiReadiness(surface, !hasPossiblyInaccurateTypes)

      if (hasPossiblyInaccurateTypes)
        markPossiblyInaccurateGeneratedContract(swaggerOperation)
    }
  }
}

const normalizeApiSwagger = (document: SwaggerDocument, surface: string) => {
  normalizeOperations(document, surface)

  return document
}

const printApiReadinessStats = () => {
  const sortedSurfaces = Object.entries(apiReadinessStats)
    .sort(([left], [right]) => left.localeCompare(right))

  const totals = sortedSurfaces.reduce(
    (summary, [, stats]) => {
      summary.notReady += stats.notReady
      summary.total += stats.total
      return summary
    },
    { notReady: 0, total: 0 },
  )
  const totalReady = totals.total - totals.notReady
  const rows = sortedSurfaces.map(([surface, stats]) => {
    const ready = stats.total - stats.notReady
    return `  ${surface}: ${ready}/${stats.total} ready (${formatPercent(ready, stats.total)}), ${stats.notReady} not ready`
  })

  console.log([
    'API OpenAPI readiness:',
    ...rows,
    `  total: ${totalReady}/${totals.total} ready (${formatPercent(totalReady, totals.total)}), ${totals.notReady} not ready`,
  ].join('\n'))
}

const topLevelPathSegment = (routePath: string) => {
  return routePath.split('/').filter(Boolean)[0] ?? 'root'
}

const selectReferencedSchemas = (
  schemas: Record<string, SwaggerSchema>,
  paths: Record<string, Record<string, unknown>>,
) => {
  const selectedSchemas: Record<string, SwaggerSchema> = {}
  const pendingRefs = new Set<string>()
  collectSchemaRefs(paths, pendingRefs)

  while (pendingRefs.size > 0) {
    const refName = pendingRefs.values().next().value
    if (!refName)
      break

    pendingRefs.delete(refName)

    if (selectedSchemas[refName])
      continue

    selectedSchemas[refName] = schemas[refName] ?? unknownObjectSchema()

    const nestedRefs = new Set<string>()
    collectSchemaRefs(selectedSchemas[refName], nestedRefs)
    for (const nestedRef of nestedRefs) {
      if (!selectedSchemas[nestedRef])
        pendingRefs.add(nestedRef)
    }
  }

  return selectedSchemas
}

const cloneDocumentWithPaths = (
  document: SwaggerDocument,
  paths: Record<string, Record<string, unknown>>,
) => {
  const { components: _components, paths: _paths, ...metadata } = document
  const clonedPaths = clone(paths)
  const components = clone(document.components ?? {})
  const sourceSchemas = getDocumentSchemas(document)

  components.schemas = selectReferencedSchemas(sourceSchemas, clonedPaths)

  return {
    ...clone(metadata),
    components,
    paths: clonedPaths,
  } satisfies SwaggerDocument
}

const consoleContractEntryContent = (segments: string[]) => {
  const contracts = segments.map((segment) => {
    return {
      importPath: toKebabCase(segment),
      name: toCamelCase(segmentWords(segment)),
    }
  })

  const imports = contracts
    .map(contract => `import { ${contract.name} } from './${contract.importPath}/orpc.gen'`)
    .join('\n')
  const contractEntries = contracts.map(contract => `  ${contract.name},`).join('\n')

  return `// This file is auto-generated by @hey-api/openapi-ts

${imports}

export const contract = {
${contractEntries}
}
`
}

const writeConsoleContractEntry = (segments: string[]) => {
  const entryPath = path.resolve(currentDir, 'generated/api/console/orpc.gen.ts')
  fs.mkdirSync(path.dirname(entryPath), { recursive: true })
  fs.writeFileSync(entryPath, consoleContractEntryContent(segments))
}

const createConsoleContractEntryJob = (document: SwaggerDocument, segments: string[]): ApiJob => {
  return {
    clean: false,
    document,
    outputPath: 'generated/api/console',
    plugins: [],
    source: {
      callback: () => writeConsoleContractEntry(segments),
      enabled: true,
      path: null,
      serialize: () => '',
    },
  }
}

const splitConsoleDocument = (document: SwaggerDocument) => {
  const pathsBySegment = new Map<string, Record<string, Record<string, unknown>>>()

  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    const segment = topLevelPathSegment(routePath)
    const paths = pathsBySegment.get(segment) ?? {}
    paths[routePath] = pathItem
    pathsBySegment.set(segment, paths)
  }

  const segments = [...pathsBySegment.keys()].sort((left, right) => left.localeCompare(right))
  const jobs = segments.map((segment): ApiJob => ({
    document: cloneDocumentWithPaths(document, pathsBySegment.get(segment) ?? {}),
    outputPath: `generated/api/console/${toKebabCase(segment)}`,
  }))

  return [...jobs, createConsoleContractEntryJob(document, segments)]
}

const createApiJobs = (spec: ApiSpec): ApiJob[] => {
  const document = normalizeApiSwagger(readApiSwagger(spec.filename), spec.name)

  if (spec.name === 'console')
    return splitConsoleDocument(document)

  return [
    {
      document,
      outputPath: `generated/api/${spec.name}`,
    },
  ]
}

const apiJobs = apiSpecs.flatMap(createApiJobs)
printApiReadinessStats()

const createApiConfig = (job: ApiJob): UserConfig => ({
  input: job.document,
  logs: {
    file: false,
  },
  output: {
    ...(job.clean === undefined ? {} : { clean: job.clean }),
    entryFile: false,
    fileName: {
      suffix: '.gen',
    },
    path: job.outputPath,
    ...(job.source ? { source: job.source } : {}),
  },
  plugins: job.plugins ?? [
    {
      comments: false,
      name: '@hey-api/typescript',
    },
    {
      'name': 'zod',
      '~resolvers': {
        string: (ctx) => {
          if (ctx.schema.format !== 'binary')
            return undefined

          return $(ctx.symbols.z).attr('custom').call().generic($.type.or($.type('Blob'), $.type('File')))
        },
      },
    },
    {
      contracts: {
        contractName: {
          casing: 'camelCase',
          name: '{{name}}',
        },
        nesting: contractPathSegments,
        segmentName: {
          casing: 'camelCase',
          name: '{{name}}',
        },
        strategy: 'single',
      },
      name: 'orpc',
      validator: 'zod',
    },
  ],
})

export default defineConfig(apiJobs.map(createApiConfig))
