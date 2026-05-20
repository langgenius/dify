import type { UserConfig } from '@hey-api/openapi-ts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@hey-api/openapi-ts'

type JsonObject = Record<string, unknown>

type SwaggerSchema = JsonObject & {
  '$defs'?: Record<string, SwaggerSchema>
  '$ref'?: string
  'x-nullable'?: boolean
  'additionalProperties'?: unknown
  'allOf'?: SwaggerSchema[]
  'anyOf'?: SwaggerSchema[]
  'const'?: unknown
  'default'?: unknown
  'definitions'?: Record<string, SwaggerSchema>
  'description'?: string
  'enum'?: unknown[]
  'format'?: string
  'items'?: SwaggerSchema
  'oneOf'?: SwaggerSchema[]
  'properties'?: Record<string, SwaggerSchema>
  'required'?: string[]
  'type'?: string
}

type SwaggerParameter = JsonObject & {
  in?: string
  name?: string
  required?: boolean
  schema?: SwaggerSchema
  type?: string
}

type SwaggerResponse = JsonObject & {
  description?: string
  schema?: SwaggerSchema
}

type SwaggerOperation = JsonObject & {
  deprecated?: boolean
  description?: string
  operationId?: string
  parameters?: SwaggerParameter[]
  responses?: Record<string, SwaggerResponse>
}

type SwaggerDocument = JsonObject & {
  definitions?: Record<string, SwaggerSchema>
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
  { filename: 'console-swagger.json', name: 'console' },
  { filename: 'web-swagger.json', name: 'web' },
  { filename: 'service-swagger.json', name: 'service' },
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

const noContentSchema = (): SwaggerSchema => ({
  // Hey API's Swagger 2.0 pipeline currently needs a response schema symbol even for no-content responses.
  additionalProperties: false,
  properties: {},
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

const collectDefinitionRefs = (value: unknown, refs: Set<string>, visited = new WeakSet<object>()) => {
  if (!value || typeof value !== 'object')
    return

  if (visited.has(value))
    return

  visited.add(value)

  if (Array.isArray(value)) {
    value.forEach(item => collectDefinitionRefs(item, refs, visited))
    return
  }

  const objectValue = value as JsonObject
  const ref = objectValue.$ref
  if (typeof ref === 'string' && ref.startsWith('#/definitions/'))
    refs.add(ref.slice('#/definitions/'.length))

  Object.values(objectValue).forEach(item => collectDefinitionRefs(item, refs, visited))
}

const removeNullDefaults = (value: unknown, visited = new WeakSet<object>()) => {
  if (!value || typeof value !== 'object' || visited.has(value))
    return

  visited.add(value)

  if (Array.isArray(value)) {
    value.forEach(item => removeNullDefaults(item, visited))
    return
  }

  const schema = value as SwaggerSchema
  if (schema.default === null)
    delete schema.default

  Object.values(schema).forEach(item => removeNullDefaults(item, visited))
}

const isNullSchema = (schema: SwaggerSchema) => {
  return schema.type === 'null'
}

const normalizeNullableAnyOf = (value: unknown, visited = new WeakSet<object>()) => {
  if (!value || typeof value !== 'object' || visited.has(value))
    return

  visited.add(value)

  if (Array.isArray(value)) {
    value.forEach(item => normalizeNullableAnyOf(item, visited))
    return
  }

  const schema = value as SwaggerSchema

  if (Array.isArray(schema.anyOf)) {
    const nonNullSchemas = schema.anyOf.filter(item => !isNullSchema(item))
    const hasNullSchema = nonNullSchemas.length !== schema.anyOf.length

    if (hasNullSchema && nonNullSchemas.length === 1) {
      const { anyOf: _anyOf, ...rest } = schema
      Object.keys(schema).forEach(key => delete schema[key])
      Object.assign(schema, rest, nonNullSchemas[0], { 'x-nullable': true })
    }
  }

  Object.values(schema).forEach(item => normalizeNullableAnyOf(item, visited))
}

const hoistNestedDefinitions = (definitions: Record<string, SwaggerSchema>) => {
  const visited = new WeakSet<object>()

  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || visited.has(value))
      return

    visited.add(value)

    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }

    const schema = value as SwaggerSchema
    for (const key of ['$defs', 'definitions'] as const) {
      const nestedDefinitions = schema[key]
      if (!isObject(nestedDefinitions))
        continue

      for (const [name, nestedSchema] of Object.entries(nestedDefinitions)) {
        definitions[name] ??= nestedSchema
        visit(nestedSchema)
      }

      delete schema[key]
    }

    Object.values(schema).forEach(visit)
  }

  Object.values(definitions).forEach(visit)
}

const ensureReferencedDefinitions = (document: SwaggerDocument) => {
  const definitions = document.definitions ??= {}
  const refs = new Set<string>()
  collectDefinitionRefs(document, refs)

  for (const refName of refs)
    definitions[refName] ??= unknownObjectSchema()
}

const resolveDefinitionRef = (
  schema: SwaggerSchema | undefined,
  definitions: Record<string, SwaggerSchema>,
): SwaggerSchema | undefined => {
  const ref = schema?.$ref

  if (!ref?.startsWith('#/definitions/'))
    return schema

  return definitions[ref.slice('#/definitions/'.length)] ?? schema
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

const isNullEnumItem = (item: unknown) => {
  return isObject(item) && (item.type === 'null' || item.const === null)
}

const markNullableEnumSchema = (ctx: { schema: JsonObject }): undefined => {
  const items = ctx.schema.items

  if (ctx.schema['x-nullable'] !== true || !Array.isArray(items) || items.some(isNullEnumItem))
    return undefined

  // Hey API's enum visitors infer nullable from a null enum item, not x-nullable.
  ctx.schema.items = [...items, { const: null, type: 'null' }]

  return undefined
}

const queryParameterFromSchema = (
  name: string,
  schema: SwaggerSchema | undefined,
  required: boolean,
): SwaggerParameter => {
  const querySchema = withoutNullableWrapper(schema)
  const parameter: SwaggerParameter = {
    in: 'query',
    name,
    required,
  }

  if (querySchema.default !== undefined)
    parameter.default = querySchema.default

  if (querySchema.description)
    parameter.description = querySchema.description

  if (querySchema.enum)
    parameter.enum = querySchema.enum

  if (querySchema.format)
    parameter.format = querySchema.format

  if (querySchema.items)
    parameter.items = querySchema.items

  for (const key of [
    'exclusiveMaximum',
    'exclusiveMinimum',
    'maxItems',
    'maxLength',
    'maximum',
    'minItems',
    'minLength',
    'minimum',
    'multipleOf',
    'pattern',
    'uniqueItems',
    'x-nullable',
  ]) {
    if (querySchema[key] !== undefined)
      parameter[key] = querySchema[key]
  }

  parameter.type = ['array', 'boolean', 'integer', 'number', 'string'].includes(querySchema.type ?? '')
    ? querySchema.type
    : 'string'

  return parameter
}

const mergeQueryParameter = (
  parameters: SwaggerParameter[],
  queryParameter: SwaggerParameter,
) => {
  const existingIndex = parameters.findIndex((parameter) => {
    return parameter.in === 'query' && parameter.name === queryParameter.name
  })

  if (existingIndex === -1) {
    parameters.push(queryParameter)
    return
  }

  const existingParameter = parameters[existingIndex]
  if (!existingParameter) {
    parameters.push(queryParameter)
    return
  }

  parameters[existingIndex] = {
    ...existingParameter,
    ...queryParameter,
    description: queryParameter.description ?? existingParameter.description,
    required: Boolean(existingParameter.required) || Boolean(queryParameter.required),
  }
}

const normalizeGetBodyParameters = (
  operation: SwaggerOperation,
  definitions: Record<string, SwaggerSchema>,
) => {
  if (!Array.isArray(operation.parameters))
    return

  const bodyParameters: SwaggerParameter[] = []
  const normalizedParameters: SwaggerParameter[] = []

  for (const parameter of operation.parameters) {
    if (parameter.in === 'body') {
      bodyParameters.push(parameter)
      continue
    }

    normalizedParameters.push(parameter)
  }

  for (const parameter of bodyParameters) {
    const schema = resolveDefinitionRef(parameter.schema, definitions)
    const properties = schema?.properties ?? {}
    const required = new Set(schema?.required ?? [])

    for (const [name, propertySchema] of Object.entries(properties)) {
      mergeQueryParameter(
        normalizedParameters,
        queryParameterFromSchema(name, propertySchema, required.has(name)),
      )
    }
  }

  operation.parameters = normalizedParameters
}

const normalizeResponses = (operation: SwaggerOperation) => {
  const responses = operation.responses ??= {}

  for (const [status, response] of Object.entries(responses)) {
    if (noBodyResponseStatuses.has(status)) {
      response.schema = noContentSchema()
      continue
    }

    if (!response.schema)
      response.schema = unknownObjectSchema()
  }

  if (!Object.keys(responses).some(status => /^2\d\d$/.test(status))) {
    responses['200'] = {
      description: 'Success',
      schema: unknownObjectSchema(),
    }
  }
}

const hasProperties = (schema: SwaggerSchema) => {
  return isObject(schema.properties) && Object.keys(schema.properties).length > 0
}

const isEmptySchemaObject = (value: unknown) => {
  return isObject(value) && Object.keys(value).length === 0
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
  definitions: Record<string, SwaggerSchema>,
  visitedRefs = new Set<string>(),
): boolean => {
  if (!schema)
    return true

  const ref = schema?.$ref
  if (ref?.startsWith('#/definitions/')) {
    const refName = ref.slice('#/definitions/'.length)
    if (visitedRefs.has(refName))
      return false

    return hasLooseSchema(definitions[refName], definitions, new Set([...visitedRefs, refName]))
  }

  const normalizedSchema = withoutNullableWrapper(schema)

  for (const variants of [normalizedSchema.allOf, normalizedSchema.anyOf, normalizedSchema.oneOf]) {
    if (Array.isArray(variants) && variants.some(item => !isNullSchema(item) && hasLooseSchema(item, definitions, visitedRefs)))
      return true
  }

  if (normalizedSchema.type === 'array')
    return hasLooseSchema(normalizedSchema.items, definitions, visitedRefs)

  if (isLooseObjectSchema(normalizedSchema))
    return true

  if (isObject(normalizedSchema.additionalProperties) && hasLooseSchema(normalizedSchema.additionalProperties, definitions, visitedRefs))
    return true

  return Object.values(normalizedSchema.properties ?? {})
    .some(property => hasLooseSchema(property, definitions, visitedRefs))
}

const hasPossiblyInaccurateGeneratedContractTypes = (
  operation: SwaggerOperation,
  definitions: Record<string, SwaggerSchema>,
  context: ApiOperationContext,
) => {
  const successResponses = Object.entries(operation.responses ?? {})
    .filter(([status]) => /^2\d\d$/.test(status))

  if (successResponses.length === 0)
    return true

  const successResponsesWithBody = successResponses.filter(([status]) => !noBodyResponseStatuses.has(status))
  if (successResponsesWithBody.some(([, response]) => hasLooseSchema(response.schema, definitions)))
    return true

  if (context.runtimeBodyRequired && !operation.parameters?.some(parameter => parameter.in === 'body'))
    return true

  return operation.parameters?.some((parameter) => {
    return parameter.in === 'body' && hasLooseSchema(parameter.schema, definitions)
  }) ?? false
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
  const definitions = document.definitions ??= {}

  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operationMethods.has(method) || !isObject(operation))
        continue

      const swaggerOperation = operation as SwaggerOperation
      swaggerOperation.operationId = operationId(method, routePath)

      normalizeResponses(swaggerOperation)
      const hasPossiblyInaccurateTypes = hasPossiblyInaccurateGeneratedContractTypes(swaggerOperation, definitions, {
        method,
        routePath,
        runtimeBodyRequired: runtimeBodyOperationKeys.has(apiOperationKey(surface, method, routePath)),
      })
      recordApiReadiness(surface, !hasPossiblyInaccurateTypes)

      if (method === 'get')
        normalizeGetBodyParameters(swaggerOperation, definitions)

      if (hasPossiblyInaccurateTypes)
        markPossiblyInaccurateGeneratedContract(swaggerOperation)
    }
  }
}

const normalizeApiSwagger = (document: SwaggerDocument, surface: string) => {
  document.definitions ??= {}

  // Flask-RESTX emits Pydantic nested $defs inside individual schemas while
  // refs point at the root Swagger 2.0 definitions object.
  hoistNestedDefinitions(document.definitions)
  ensureReferencedDefinitions(document)
  normalizeNullableAnyOf(document)
  removeNullDefaults(document)
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

const selectReferencedDefinitions = (
  definitions: Record<string, SwaggerSchema>,
  paths: Record<string, Record<string, unknown>>,
) => {
  const selectedDefinitions: Record<string, SwaggerSchema> = {}
  const pendingRefs = new Set<string>()
  collectDefinitionRefs(paths, pendingRefs)

  while (pendingRefs.size > 0) {
    const refName = pendingRefs.values().next().value
    if (!refName)
      break

    pendingRefs.delete(refName)

    if (selectedDefinitions[refName])
      continue

    selectedDefinitions[refName] = definitions[refName] ?? unknownObjectSchema()

    const nestedRefs = new Set<string>()
    collectDefinitionRefs(selectedDefinitions[refName], nestedRefs)
    for (const nestedRef of nestedRefs) {
      if (!selectedDefinitions[nestedRef])
        pendingRefs.add(nestedRef)
    }
  }

  return selectedDefinitions
}

const cloneDocumentWithPaths = (
  document: SwaggerDocument,
  paths: Record<string, Record<string, unknown>>,
) => {
  const { definitions: _definitions, paths: _paths, ...metadata } = document
  const clonedPaths = clone(paths)

  return {
    ...clone(metadata),
    definitions: selectReferencedDefinitions(document.definitions ?? {}, clonedPaths),
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
      'comments': false,
      'name': '@hey-api/typescript',
      '~resolvers': {
        enum: markNullableEnumSchema,
      },
    },
    {
      'name': 'zod',
      '~resolvers': {
        enum: markNullableEnumSchema,
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
