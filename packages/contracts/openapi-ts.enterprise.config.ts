import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@hey-api/openapi-ts'
import yaml from 'js-yaml'

type JsonObject = Record<string, unknown>

type OpenApiDocument = JsonObject & {
  paths?: Record<string, unknown>
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

const isConsoleApiPath = (routePath: string) => routePath.startsWith('/console/api/')

const stripConsoleApiPrefix = (routePath: string) => {
  if (isConsoleApiPath(routePath))
    return routePath.replace('/console/api', '')

  return routePath
}

const stripSchemaNamePrefix = (schemaName: string) => {
  return schemaName
    .replace(/^dify\.enterprise\.api\.enterprise\./, '')
    .replace(/^pagination\./, '')
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
  return [operation.tags?.[0] || 'default', ...contractNameSegments(operation)]
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
      .map(([routePath, pathItem]) => [stripConsoleApiPrefix(routePath), pathItem]),
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
