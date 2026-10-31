type JsonObject = Record<string, unknown>

export type SwaggerSchema = JsonObject & {
  $ref?: string
}

type OpenApiMediaType = JsonObject & {
  schema?: SwaggerSchema
}

type OpenApiResponse = JsonObject & {
  content?: Record<string, OpenApiMediaType>
}

type OpenApiComponents = JsonObject & {
  schemas?: Record<string, SwaggerSchema>
}

export type SwaggerOperation = JsonObject & {
  operationId?: string
  responses?: Record<string, OpenApiResponse>
}

export type SwaggerDocument = JsonObject & {
  components?: OpenApiComponents
  openapi?: string
  paths?: Record<string, Record<string, unknown>>
}

export type ApiSpec = {
  filename: string
  name: string
}

type ApiContractOperation = {
  method: string
  path: string
}

export const operationMethods = new Set(['delete', 'get', 'patch', 'post', 'put'])
export const fastOpenApiConsoleSpecFilename = 'fastopenapi-console-openapi.json'
const fastOpenApiConsolePathPrefix = '/console/api'

export const apiSpecs: ApiSpec[] = [
  { filename: 'console-openapi.json', name: 'console' },
  { filename: 'web-openapi.json', name: 'web' },
  { filename: 'service-openapi.json', name: 'service' },
  { filename: 'openapi-openapi.json', name: 'openapi' },
]

export const isObject = (value: unknown): value is JsonObject => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const toWords = (value: string) => {
  return value
    .replace(/[{}]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
}

const toPascalCase = (words: string[]) => {
  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('')
}

export const toCamelCase = (words: string[]) => {
  const pascal = toPascalCase(words)
  return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`
}

export const toKebabCase = (value: string) => {
  return toWords(value).join('-').toLowerCase()
}

export const segmentWords = (segment: string) => {
  if (segment.startsWith('{') && segment.endsWith('}')) return ['by', ...toWords(segment)]

  return toWords(segment)
}

// Split on `:` too so custom methods nest as their own node (apps.byAppId.run), not apps.appIdRun.
const routeNamingSegments = (routePath: string) => routePath.split(/[/:]/).filter(Boolean)

const routeWords = (routePath: string) => {
  return routeNamingSegments(routePath).flatMap(segmentWords)
}

const operationId = (method: string, routePath: string) => {
  return toCamelCase([
    method,
    ...(routeWords(routePath).length > 0 ? routeWords(routePath) : ['root']),
  ])
}

export const contractPathSegments = (operation: ApiContractOperation) => {
  const segments = routeNamingSegments(operation.path).map((segment) =>
    toCamelCase(segmentWords(segment)),
  )

  return [...(segments.length > 0 ? segments : ['root']), operation.method.toLowerCase()]
}

const clone = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T
}

const componentSchemaRefPrefix = '#/components/schemas/'

export const schemaNameFromRef = (ref: string) => {
  if (ref.startsWith(componentSchemaRefPrefix)) return ref.slice(componentSchemaRefPrefix.length)
  return undefined
}

export const getDocumentSchemas = (document: SwaggerDocument) => {
  const components = (document.components ??= {})
  return (components.schemas ??= {})
}

const collectSchemaRefs = (value: unknown, refs: Set<string>, visited = new WeakSet<object>()) => {
  if (!value || typeof value !== 'object') return

  if (visited.has(value)) return

  visited.add(value)

  if (Array.isArray(value)) {
    value.forEach((item) => collectSchemaRefs(item, refs, visited))
    return
  }

  const objectValue = value as JsonObject
  const ref = objectValue.$ref
  if (typeof ref === 'string') {
    const refName = schemaNameFromRef(ref)
    if (refName) refs.add(refName)
  }

  Object.values(objectValue).forEach((item) => collectSchemaRefs(item, refs, visited))
}

const addOperationIds = (document: SwaggerDocument) => {
  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operationMethods.has(method) || !isObject(operation)) continue

      const swaggerOperation = operation as SwaggerOperation
      swaggerOperation.operationId = operationId(method, routePath)
    }
  }
}

const normalizeOpaqueContractResponses = (document: SwaggerDocument) => {
  // This runs before contract filtering. Flask-RESTX often emits plain success responses
  // without a body schema; give those routes an opaque output so they stay in oRPC.
  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operationMethods.has(method) || !isObject(operation)) continue

      const swaggerOperation = operation as SwaggerOperation
      for (const [status, response] of Object.entries(swaggerOperation.responses ?? {})) {
        // Ignore non-2xx or 204 or those w/o a response field
        if (!/^2\d\d$/.test(status) || status === '204' || !isObject(response)) continue

        const content = response.content
        if (!isObject(content) || Object.keys(content).length === 0) {
          // No response specification, fill a dummy opaque resp
          response.content = {
            'application/json': {
              schema: {
                additionalProperties: true,
                type: 'object',
              },
            },
          }
          continue
        }

        for (const [mediaType, media] of Object.entries(content)) {
          if (mediaType !== 'application/json' && mediaType !== 'text/event-stream') continue
          if (!isObject(media) || isObject(media.schema)) continue

          // JSON/SSE media without a schema traps heyapi. Patch only that media entry so
          // sibling binary media keeps heyapi's Blob | File inference.
          // Still a dummy opaque resp
          media.schema = {
            additionalProperties: true,
            type: 'object',
          }
        }
      }
    }
  }
}

const hasSuccessResponse = (operation: SwaggerOperation) => {
  return Object.entries(operation.responses ?? {}).some(([status, response]) => {
    if (!/^2\d\d$/.test(status)) return false
    if (!isObject(response)) return false
    const content = (response as JsonObject).content
    // 204 No Content is a valid success response without a body
    if (!isObject(content) || Object.keys(content).length === 0) return status === '204'
    return true
  })
}

const filterContractOperations = (document: SwaggerDocument) => {
  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operationMethods.has(method) || !isObject(operation)) continue

      if (!hasSuccessResponse(operation as SwaggerOperation)) delete pathItem[method]
    }

    const hasOperations = Object.entries(pathItem).some(
      ([method, operation]) => operationMethods.has(method) && isObject(operation),
    )

    if (!hasOperations) delete document.paths?.[routePath]
  }
}

const includeMultipartRequestSchemas = (document: SwaggerDocument) => {
  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operationMethods.has(method) || !isObject(operation) || !isObject(operation.requestBody))
        continue
      const content = operation.requestBody.content
      if (!isObject(content)) continue
      const json = content['application/json']
      const multipart = content['multipart/form-data']
      if (
        !isObject(json) ||
        !isObject(json.schema) ||
        !isObject(multipart) ||
        !isObject(multipart.schema)
      )
        continue

      // hey-api selects JSON for mixed request media; retain the multipart shape
      // so the generated client can serialize File values as FormData.
      json.schema = { anyOf: [json.schema, multipart.schema] }
    }
  }
}

const includeNonJsonResponseSchemas = (document: SwaggerDocument) => {
  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operationMethods.has(method) || !isObject(operation)) continue

      for (const [status, response] of Object.entries(
        (operation as SwaggerOperation).responses ?? {},
      )) {
        if (!/^2\d\d$/.test(status) || !isObject(response) || !isObject(response.content)) continue

        const jsonMedia = response.content['application/json']
        if (!isObject(jsonMedia) || !isObject(jsonMedia.schema)) continue

        const alternatives: SwaggerSchema[] = []
        for (const [mediaType, media] of Object.entries(response.content)) {
          if (mediaType === 'application/json' || !isObject(media) || !isObject(media.schema))
            continue
          if (mediaType === 'text/event-stream' || media.schema.format === 'binary')
            alternatives.push(media.schema)
        }
        if (alternatives.length === 0) continue

        // hey-api selects the JSON schema when one status advertises multiple
        // response media types. Preserve SSE and binary transports in the generated
        // TypeScript and Zod contracts by making that selected schema a union.
        jsonMedia.schema = {
          anyOf: [jsonMedia.schema, ...alternatives],
        }
      }
    }
  }
}

const normalizeCodegenSchemas = (document: SwaggerDocument) => {
  const visitedSchemas = new WeakSet<object>()

  const visitSchema = (value: unknown) => {
    if (!isObject(value) || visitedSchemas.has(value)) return

    visitedSchemas.add(value)
    if (value.default === null) delete value.default
    // Dify serializes int64 fields as JSON numbers. hey-api maps int64 to
    // bigint in Zod, which disagrees with both the wire value and its own
    // generated TypeScript type. Keep int64 in the published OpenAPI specs,
    // but generate number-based client validators from this in-memory copy.
    if (value.type === 'integer' && value.format === 'int64') delete value.format

    for (const key of [
      'additionalProperties',
      'contains',
      'else',
      'if',
      'items',
      'not',
      'propertyNames',
      'then',
      'unevaluatedItems',
      'unevaluatedProperties',
    ]) {
      visitSchema(value[key])
    }

    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
      const schemas = value[key]
      if (Array.isArray(schemas)) schemas.forEach(visitSchema)
    }

    for (const key of [
      '$defs',
      'definitions',
      'dependentSchemas',
      'patternProperties',
      'properties',
    ]) {
      const schemas = value[key]
      if (isObject(schemas)) Object.values(schemas).forEach(visitSchema)
    }
  }

  const visitedDocumentObjects = new WeakSet<object>()
  const findSchemas = (value: unknown, parentKey?: string) => {
    if (!value || typeof value !== 'object' || visitedDocumentObjects.has(value)) return

    visitedDocumentObjects.add(value)
    if (parentKey === 'schema') {
      visitSchema(value)
      return
    }
    if (parentKey === 'schemas' && isObject(value)) {
      Object.values(value).forEach(visitSchema)
      return
    }
    if (parentKey === 'example' || parentKey === 'examples') return

    if (Array.isArray(value)) {
      value.forEach((item) => findSchemas(item))
      return
    }

    Object.entries(value).forEach(([key, item]) => findSchemas(item, key))
  }

  findSchemas(document)
}

export const normalizeApiSwagger = (document: SwaggerDocument) => {
  normalizeOpaqueContractResponses(document)
  filterContractOperations(document)
  addOperationIds(document)
  includeMultipartRequestSchemas(document)
  includeNonJsonResponseSchemas(document)
  // OpenAPI defaults describe server behavior. Keep them in the exported specs,
  // but do not let Zod synthesize omitted transport fields during client-side
  // request or response validation. Non-null defaults remain useful for query
  // parameter ergonomics and preserve the existing generated contract behavior.
  normalizeCodegenSchemas(document)

  return document
}

export const mergeFastOpenApiConsoleSwagger = (
  document: SwaggerDocument,
  fastOpenApiDocument: SwaggerDocument,
) => {
  const targetPaths = (document.paths ??= {})

  for (const [routePath, pathItem] of Object.entries(fastOpenApiDocument.paths ?? {})) {
    const contractPath = routePath.startsWith(fastOpenApiConsolePathPrefix)
      ? routePath.slice(fastOpenApiConsolePathPrefix.length) || '/'
      : routePath

    if (targetPaths[contractPath])
      throw new Error(`Duplicate console API path after FastOpenAPI merge: ${contractPath}`)

    targetPaths[contractPath] = pathItem
  }

  const targetSchemas = getDocumentSchemas(document)
  const sourceSchemas = getDocumentSchemas(fastOpenApiDocument)
  for (const [schemaName, schema] of Object.entries(sourceSchemas)) {
    if (targetSchemas[schemaName])
      throw new Error(`Duplicate console API schema after FastOpenAPI merge: ${schemaName}`)

    targetSchemas[schemaName] = schema
  }

  return document
}

export const topLevelPathSegment = (routePath: string) => {
  return routePath.split('/').filter(Boolean)[0] ?? 'root'
}

export const groupConsolePaths = (document: SwaggerDocument) => {
  const groups = new Map<string, Record<string, Record<string, unknown>>>()
  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    const segment = topLevelPathSegment(routePath)
    const paths = groups.get(segment) ?? {}
    paths[routePath] = pathItem
    groups.set(segment, paths)
  }
  return groups
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
    if (!refName) break

    pendingRefs.delete(refName)

    if (selectedSchemas[refName]) continue

    const schema = schemas[refName]
    if (!schema) throw new Error(`Missing referenced schema: ${refName}`)

    selectedSchemas[refName] = schema

    const nestedRefs = new Set<string>()
    collectSchemaRefs(selectedSchemas[refName], nestedRefs)
    for (const nestedRef of nestedRefs) {
      if (!selectedSchemas[nestedRef]) pendingRefs.add(nestedRef)
    }
  }

  return selectedSchemas
}

export const cloneDocumentWithPaths = (
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
