import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@hey-api/openapi-ts'
import { loadOpenApiYaml } from './openapi-yaml'

type JsonObject = Record<string, unknown>

type OpenApiDocument = JsonObject & {
  components?: OpenApiComponents
  paths?: Record<string, unknown>
}

type OpenApiComponents = JsonObject & {
  schemas?: Record<string, OpenApiSchema>
}

type OpenApiMediaType = JsonObject & {
  schema?: unknown
}

type OpenApiOperation = JsonObject & {
  operationId?: string
  responses?: Record<string, OpenApiResponse>
}

type OpenApiPathItem = Record<string, unknown>

type OpenApiResponse = JsonObject & {
  content?: Record<string, OpenApiMediaType>
}

type OpenApiSchema = JsonObject & {
  enum?: unknown[]
  format?: string
  properties?: Record<string, OpenApiSchema>
  type?: string | string[]
}

type ContractOperation = {
  id: string
  operationId?: string
  tags?: readonly string[]
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const enterpriseServerDir = process.env.DIFY_ENTERPRISE_SERVER
  ? path.resolve(process.env.DIFY_ENTERPRISE_SERVER)
  : path.resolve(currentDir, '../../../dify-enterprise/server')
const enterpriseOpenApiPath = path.join(enterpriseServerDir, 'pkg/apis/enterprise/openapi.yaml')
const operationMethods = new Set(['delete', 'get', 'patch', 'post', 'put'])

const isConsoleApiPath = (routePath: string) => routePath.startsWith('/console/api/')

const isObject = (value: unknown): value is JsonObject => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const isOpenApiSchema = (value: unknown): value is OpenApiSchema => {
  return isObject(value)
}

const asOpenApiOperation = (value: unknown): OpenApiOperation | undefined => {
  return isObject(value) ? value as OpenApiOperation : undefined
}

const asOpenApiResponse = (value: unknown): OpenApiResponse | undefined => {
  return isObject(value) ? value as OpenApiResponse : undefined
}

const asOpenApiMediaType = (value: unknown): OpenApiMediaType | undefined => {
  return isObject(value) ? value as OpenApiMediaType : undefined
}

const stripConsoleApiPrefix = (routePath: string) => {
  if (isConsoleApiPath(routePath))
    return routePath.replace('/console/api', '')

  return routePath
}

const stripSchemaNamePrefix = (schemaName: string) => {
  return schemaName
    .replace(/^dify\.enterprise\.api\.enterprise\./, '')
    .replace(/^dify\.enterprise\.api\.appdeploy\.v1\./, '')
    .replace(/^dify\.enterprise\.api\.appdeploy\./, '')
    .replace(/^pagination\./, '')
}

const contractTagSegment = (tag?: string) => {
  if (tag === 'EnterpriseAppDeployConsole')
    return 'AppDeploy'

  return tag || 'default'
}

const contractNameSegments = (operation: ContractOperation) => {
  const operationId = operation.operationId || operation.id
  const tag = operation.tags?.[0]
  const tagPrefixPattern = tag ? new RegExp(`^${tag}[._/-]`) : undefined
  const name = tagPrefixPattern ? operationId.replace(tagPrefixPattern, '') : operationId
  const segments = name.split(/[._/-]+/).filter(Boolean)

  return segments.length > 0 ? segments : [operationId]
}

const contractPathSegments = (operation: ContractOperation) => {
  return [contractTagSegment(operation.tags?.[0]), ...contractNameSegments(operation)]
}

const hasSchemaLessResponseContent = (operation: OpenApiOperation) => {
  if (!isObject(operation.responses))
    return false

  return Object.values(operation.responses).some((response) => {
    const openApiResponse = asOpenApiResponse(response)
    if (!openApiResponse || !isObject(openApiResponse.content))
      return false

    return Object.values(openApiResponse.content).some((mediaType) => {
      const openApiMediaType = asOpenApiMediaType(mediaType)
      return !!openApiMediaType && !('schema' in openApiMediaType)
    })
  })
}

// protoc-gen-openapi emits google.api.HttpBody responses as `*/*: {}`. Skip these
// raw download operations until the source OpenAPI exposes an explicit schema.
const stripSchemaLessResponseOperations = (pathItem: OpenApiPathItem) => {
  return Object.fromEntries(
    Object.entries(pathItem).filter(([method, operation]) => {
      if (!operationMethods.has(method.toLowerCase()))
        return true

      const openApiOperation = asOpenApiOperation(operation)
      return !openApiOperation || !hasSchemaLessResponseContent(openApiOperation)
    }),
  )
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

const commonWordPrefix = (values: string[]) => {
  const wordLists = values.map(value => value.split('_'))
  const firstWords = wordLists[0] ?? []
  const prefix: string[] = []

  for (const [index, word] of firstWords.entries()) {
    if (!wordLists.every(words => words[index] === word))
      break

    prefix.push(word)
  }

  return prefix
}

const enumSchemaNameFromValues = (values: unknown[]) => {
  if (values.length === 0 || !values.every(value => typeof value === 'string'))
    return undefined

  const prefix = commonWordPrefix(values)
  if (prefix.length < 2)
    return undefined

  return toPascalCase(prefix.map(word => word.toLowerCase()))
}

const findSchemaEntry = (
  schemas: Record<string, OpenApiSchema>,
  schemaName: string,
): [string, OpenApiSchema] | undefined => {
  return Object.entries(schemas)
    .find(([name]) => stripSchemaNamePrefix(name) === schemaName)
}

const enumValuesKey = (values: unknown[]) => JSON.stringify(values)

const reusableEnumSchema = (propertySchema: OpenApiSchema): OpenApiSchema => ({
  ...(propertySchema.format ? { format: propertySchema.format } : {}),
  enum: propertySchema.enum,
  type: propertySchema.type ?? 'string',
})

const enumSchemaKey = (
  schemas: Record<string, OpenApiSchema>,
  preferredName: string,
  valuesKey: string,
  valuesToSchemaKey: Map<string, string>,
  schemaName: string,
  propertyName: string,
) => {
  const existingKey = valuesToSchemaKey.get(valuesKey)
  if (existingKey)
    return existingKey

  const existingEnumEntry = findSchemaEntry(schemas, preferredName)
  if (!existingEnumEntry)
    return preferredName

  const existingEnumValues = existingEnumEntry[1].enum
  if (Array.isArray(existingEnumValues) && enumValuesKey(existingEnumValues) === valuesKey)
    return existingEnumEntry[0]

  return `${stripSchemaNamePrefix(schemaName)}${toPascalCase(toWords(propertyName))}`
}

const promoteInlineEnumSchema = (
  schemas: Record<string, OpenApiSchema>,
  schemaName: string,
  properties: Record<string, OpenApiSchema>,
  propertyName: string,
  propertySchema: OpenApiSchema,
  valuesToSchemaKey: Map<string, string>,
) => {
  if (!Array.isArray(propertySchema.enum))
    return

  const preferredName = enumSchemaNameFromValues(propertySchema.enum)
  if (!preferredName)
    return

  const valuesKey = enumValuesKey(propertySchema.enum)
  const key = enumSchemaKey(schemas, preferredName, valuesKey, valuesToSchemaKey, schemaName, propertyName)

  if (!schemas[key])
    schemas[key] = reusableEnumSchema(propertySchema)

  valuesToSchemaKey.set(valuesKey, key)
  properties[propertyName] = {
    $ref: `#/components/schemas/${key}`,
  }
}

// gnostic's protoc-gen-openapi inlines proto enum schemas into every field.
// Promote prefixable inline enums to reusable schemas so Hey API can emit
// runtime enum objects from the generated contract.
const promoteReusableEnumSchemasForHeyApi = (document: OpenApiDocument) => {
  const schemas = document.components?.schemas
  if (!schemas)
    return

  const valuesToSchemaKey = new Map<string, string>()

  Object.entries(schemas).forEach(([schemaName, schema]) => {
    const properties = schema.properties
    if (!properties)
      return

    Object.entries(properties).forEach(([propertyName, propertySchema]) => {
      if (!isOpenApiSchema(propertySchema))
        return

      promoteInlineEnumSchema(schemas, schemaName, properties, propertyName, propertySchema, valuesToSchemaKey)
    })
  })
}

const normalizeEnterpriseOpenApi = () => {
  const openApi = loadOpenApiYaml(fs.readFileSync(enterpriseOpenApiPath, 'utf8'))

  if (!openApi || typeof openApi !== 'object' || Array.isArray(openApi))
    throw new Error(`Invalid enterprise OpenAPI document: ${enterpriseOpenApiPath}`)

  const document = openApi as OpenApiDocument
  const paths = document.paths ?? {}

  document.paths = Object.fromEntries(
    Object.entries(paths)
      .filter(([routePath]) => isConsoleApiPath(routePath))
      .map(([routePath, pathItem]) => {
        if (!isObject(pathItem))
          return [stripConsoleApiPrefix(routePath), pathItem]

        return [stripConsoleApiPrefix(routePath), stripSchemaLessResponseOperations(pathItem)]
      })
      .filter(([, pathItem]) => !isObject(pathItem) || Object.keys(pathItem).length > 0),
  )

  promoteReusableEnumSchemasForHeyApi(document)

  return document
}

export default defineConfig({
  input: normalizeEnterpriseOpenApi(),
  output: {
    entryFile: false,
    path: 'generated/enterprise',
    fileName: {
      suffix: '.gen',
    },
    postProcess: [
      {
        command: 'vp',
        args: ['fmt', '{{path}}'],
      },
      {
        command: 'eslint',
        args: ['--fix', '{{path}}/*.ts'],
      },
    ],
  },
  parser: {
    transforms: {
      schemaName: stripSchemaNamePrefix,
    },
  },
  plugins: [
    {
      name: '@hey-api/typescript',
      comments: false,
      enums: {
        mode: 'javascript',
      },
    },
    'zod',
    {
      name: 'orpc',
      contracts: {
        strategy: 'single',
        contractName: {
          name: '{{name}}',
          casing: 'camelCase',
        },
        nesting: contractPathSegments,
        segmentName: {
          name: '{{name}}',
          casing: 'camelCase',
        },
      },
      validator: 'zod',
    },
  ],
})
