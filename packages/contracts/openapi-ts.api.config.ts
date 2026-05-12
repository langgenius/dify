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
  'anyOf'?: SwaggerSchema[]
  'const'?: unknown
  'default'?: unknown
  'definitions'?: Record<string, SwaggerSchema>
  'description'?: string
  'enum'?: unknown[]
  'format'?: string
  'items'?: SwaggerSchema
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
  document: SwaggerDocument
  outputPath: string
}

type ApiContractOperation = {
  method: string
  path: string
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const apiOpenApiDir = path.resolve(currentDir, 'openapi')

const operationMethods = new Set(['delete', 'get', 'patch', 'post', 'put'])

const apiSpecs: ApiSpec[] = [
  { filename: 'console-swagger.json', name: 'console' },
  { filename: 'web-swagger.json', name: 'web' },
  { filename: 'service-swagger.json', name: 'service' },
]

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

  for (const response of Object.values(responses)) {
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

const normalizeOperations = (document: SwaggerDocument) => {
  const definitions = document.definitions ??= {}

  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operationMethods.has(method) || !isObject(operation))
        continue

      const swaggerOperation = operation as SwaggerOperation
      swaggerOperation.operationId = operationId(method, routePath)

      normalizeResponses(swaggerOperation)

      if (method === 'get')
        normalizeGetBodyParameters(swaggerOperation, definitions)
    }
  }
}

const normalizeApiSwagger = (document: SwaggerDocument) => {
  document.definitions ??= {}

  // Flask-RESTX emits Pydantic nested $defs inside individual schemas while
  // refs point at the root Swagger 2.0 definitions object.
  hoistNestedDefinitions(document.definitions)
  ensureReferencedDefinitions(document)
  normalizeNullableAnyOf(document)
  removeNullDefaults(document)
  normalizeOperations(document)

  return document
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

const splitConsoleDocument = (document: SwaggerDocument) => {
  const pathsBySegment = new Map<string, Record<string, Record<string, unknown>>>()

  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    const segment = topLevelPathSegment(routePath)
    const paths = pathsBySegment.get(segment) ?? {}
    paths[routePath] = pathItem
    pathsBySegment.set(segment, paths)
  }

  return [...pathsBySegment.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([segment, paths]): ApiJob => ({
      document: cloneDocumentWithPaths(document, paths),
      outputPath: `generated/api/console/${toKebabCase(segment)}`,
    }))
}

const createApiJobs = (spec: ApiSpec): ApiJob[] => {
  const document = normalizeApiSwagger(readApiSwagger(spec.filename))

  if (spec.name === 'console')
    return splitConsoleDocument(document)

  return [
    {
      document,
      outputPath: `generated/api/${spec.name}`,
    },
  ]
}

const createApiConfig = (job: ApiJob): UserConfig => ({
  input: job.document,
  logs: {
    file: false,
  },
  output: {
    entryFile: false,
    fileName: {
      suffix: '.gen',
    },
    path: job.outputPath,
    postProcess: [
      {
        args: ['fmt', '{{path}}'],
        command: 'vp',
      },
      {
        args: ['--fix', '{{path}}/*.ts'],
        command: 'eslint',
      },
    ],
  },
  plugins: [
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

export default defineConfig(apiSpecs.flatMap(createApiJobs).map(createApiConfig))
