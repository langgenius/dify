import type { UserConfig } from '@hey-api/openapi-ts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { $, defineConfig } from '@hey-api/openapi-ts'

type JsonObject = Record<string, unknown>

type SwaggerSchema = JsonObject & {
  $ref?: string
}

type OpenApiComponents = JsonObject & {
  schemas?: Record<string, SwaggerSchema>
}

type SwaggerOperation = JsonObject & {
  operationId?: string
  responses?: Record<string, unknown>
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

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const apiOpenApiDir = path.resolve(currentDir, 'openapi')

const operationMethods = new Set(['delete', 'get', 'patch', 'post', 'put'])

const apiSpecs: ApiSpec[] = [
  { filename: 'console-openapi.json', name: 'console' },
  { filename: 'web-openapi.json', name: 'web' },
  { filename: 'service-openapi.json', name: 'service' },
  { filename: 'openapi-openapi.json', name: 'openapi' },
]

const isObject = (value: unknown): value is JsonObject => {
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

const addOperationIds = (document: SwaggerDocument) => {
  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operationMethods.has(method) || !isObject(operation))
        continue

      const swaggerOperation = operation as SwaggerOperation
      swaggerOperation.operationId = operationId(method, routePath)
    }
  }
}

const hasSuccessResponse = (operation: SwaggerOperation) => {
  return Object.keys(operation.responses ?? {}).some(status => /^2\d\d$/.test(status))
}

const filterContractOperations = (document: SwaggerDocument) => {
  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operationMethods.has(method) || !isObject(operation))
        continue

      if (!hasSuccessResponse(operation as SwaggerOperation))
        delete pathItem[method]
    }

    const hasOperations = Object.entries(pathItem)
      .some(([method, operation]) => operationMethods.has(method) && isObject(operation))

    if (!hasOperations)
      delete document.paths?.[routePath]
  }
}

const normalizeApiSwagger = (document: SwaggerDocument) => {
  filterContractOperations(document)
  addOperationIds(document)

  return document
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

    const schema = schemas[refName]
    if (!schema)
      throw new Error(`Missing referenced schema: ${refName}`)

    selectedSchemas[refName] = schema

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

const apiJobs = apiSpecs.flatMap(createApiJobs)

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
