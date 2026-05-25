import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@hey-api/openapi-ts'
import yaml from 'js-yaml'

type JsonObject = Record<string, unknown>

type OpenApiDocument = JsonObject & {
  paths?: Record<string, unknown>
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

const normalizeEnterpriseOpenApi = () => {
  const openApi = yaml.load(fs.readFileSync(enterpriseOpenApiPath, 'utf8'))

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
