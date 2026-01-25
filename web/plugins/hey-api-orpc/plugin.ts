import type { IR } from '@hey-api/openapi-ts'
import type { OrpcPlugin } from './types'

import { $ } from '@hey-api/openapi-ts'

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function toZodSchemaName(operationId: string, type: 'data' | 'response'): string {
  const pascalName = capitalizeFirst(operationId)
  return type === 'data' ? `z${pascalName}Data` : `z${pascalName}Response`
}

type OperationInfo = {
  id: string
  operationId?: string
  method: string
  path: string
  summary?: string
  description?: string
  deprecated?: boolean
  tags: string[]
  hasInput: boolean
  hasOutput: boolean
  successStatusCode?: number
  zodDataSchema: string
  zodResponseSchema: string
}

function collectOperation(operation: IR.OperationObject): OperationInfo {
  const id = operation.id || `${operation.method}_${operation.path.replace(/[{}/]/g, '_')}`

  const hasPathParams = Boolean(operation.parameters?.path && Object.keys(operation.parameters.path).length > 0)
  const hasQueryParams = Boolean(operation.parameters?.query && Object.keys(operation.parameters.query).length > 0)
  const hasHeaderParams = Boolean(operation.parameters?.header && Object.keys(operation.parameters.header).length > 0)
  const hasBody = Boolean(operation.body)
  const hasInput = hasPathParams || hasQueryParams || hasHeaderParams || hasBody

  // Check if operation has a successful response with actual content
  // Look for 2xx responses that have a schema with mediaType (indicating response body)
  let hasOutput = false
  let successStatusCode: number | undefined
  if (operation.responses) {
    for (const [statusCode, response] of Object.entries(operation.responses)) {
      // Check for 2xx success responses with actual content
      if (statusCode.startsWith('2') && response?.mediaType && response?.schema) {
        hasOutput = true
        successStatusCode = Number.parseInt(statusCode, 10)
        break
      }
    }
  }

  return {
    deprecated: operation.deprecated,
    description: operation.description,
    hasInput,
    hasOutput,
    id,
    method: operation.method.toUpperCase(),
    operationId: operation.operationId || operation.id,
    path: operation.path,
    successStatusCode,
    summary: operation.summary,
    tags: operation.tags ? [...operation.tags] : [],
    zodDataSchema: toZodSchemaName(id, 'data'),
    zodResponseSchema: toZodSchemaName(id, 'response'),
  }
}

export const handler: OrpcPlugin['Handler'] = ({ plugin }) => {
  const { contractNameBuilder, groupBy } = plugin.config
  const operations: OperationInfo[] = []
  const zodImports = new Set<string>()

  // Collect all operations using hey-api's forEach
  plugin.forEach('operation', (event) => {
    const info = collectOperation(event.operation)
    operations.push(info)

    // Collect zod imports
    if (info.hasInput) {
      zodImports.add(info.zodDataSchema)
    }
    if (info.hasOutput) {
      zodImports.add(info.zodResponseSchema)
    }
  })

  // Register external symbols for imports
  const symbolOc = plugin.symbol('oc', {
    exported: false,
    external: '@orpc/contract',
  })
  const symbolZ = plugin.external('zod.z')

  // Register zod schema symbols (they come from zod plugin)
  const zodSchemaSymbols: Record<string, ReturnType<typeof plugin.symbol>> = {}
  for (const schemaName of zodImports) {
    zodSchemaSymbols[schemaName] = plugin.symbol(schemaName, {
      exported: false,
      external: './zod.gen',
    })
  }

  // Create base contract: export const base = oc.$route({ inputStructure: 'detailed', outputStructure: 'detailed' })
  const baseSymbol = plugin.symbol('base', {
    exported: true,
    meta: {
      category: 'schema',
    },
  })

  const baseNode = $.const(baseSymbol)
    .export()
    .assign(
      $(symbolOc)
        .attr('$route')
        .call(
          $.object()
            .prop('inputStructure', $.literal('detailed'))
            .prop('outputStructure', $.literal('detailed')),
        ),
    )
  plugin.node(baseNode)

  // Create contract for each operation
  // Store symbols for later use in contracts object
  const contractSymbols: Record<string, ReturnType<typeof plugin.symbol>> = {}

  for (const op of operations) {
    const contractName = contractNameBuilder(op.id)
    const contractSymbol = plugin.symbol(contractName, {
      exported: true,
      meta: {
        category: 'schema',
        resource: 'operation',
        resourceId: op.id,
      },
    })
    contractSymbols[op.id] = contractSymbol

    // Build the route config object with all available properties
    const routeConfig = $.object()
      .prop('path', $.literal(op.path))
      .prop('method', $.literal(op.method))

    // Add optional route properties
    if (op.operationId) {
      routeConfig.prop('operationId', $.literal(op.operationId))
    }
    if (op.summary) {
      routeConfig.prop('summary', $.literal(op.summary))
    }
    if (op.description) {
      routeConfig.prop('description', $.literal(op.description))
    }
    if (op.deprecated) {
      routeConfig.prop('deprecated', $.literal(true))
    }
    if (op.tags.length > 0) {
      routeConfig.prop('tags', $.fromValue(op.tags))
    }
    if (op.successStatusCode && op.successStatusCode !== 200) {
      routeConfig.prop('successStatus', $.literal(op.successStatusCode))
    }

    // Build the call chain: base.route({...}).input(...).output(...)
    let expression = $(baseSymbol)
      .attr('route')
      .call(routeConfig)

    // .input(zodDataSchema) if has input
    if (op.hasInput) {
      expression = expression
        .attr('input')
        .call($(zodSchemaSymbols[op.zodDataSchema]))
    }

    // .output(z.object({ status: z.literal(200), body: zodResponseSchema })) if has output (detailed outputStructure)
    if (op.hasOutput) {
      const outputObject = $.object()
        .prop('body', $(zodSchemaSymbols[op.zodResponseSchema]))

      // Add status code if available
      if (op.successStatusCode) {
        outputObject.prop(
          'status',
          $(symbolZ).attr('literal').call($.literal(op.successStatusCode)),
        )
      }

      expression = expression
        .attr('output')
        .call($(symbolZ).attr('object').call(outputObject))
    }

    const contractNode = $.const(contractSymbol)
      .export()
      .$if(op.summary || op.description || op.deprecated, (node) => {
        const docLines: string[] = []
        if (op.summary) {
          docLines.push(op.summary)
        }
        if (op.description && op.description !== op.summary) {
          if (op.summary)
            docLines.push('')
          docLines.push(op.description)
        }
        if (op.deprecated) {
          if (docLines.length > 0)
            docLines.push('')
          docLines.push('@deprecated')
        }
        return node.doc(docLines)
      })
      .assign(expression)

    plugin.node(contractNode)
  }

  // Create contracts object export
  const contractsSymbol = plugin.symbol('contracts', {
    exported: true,
    meta: {
      category: 'schema',
    },
  })

  if (groupBy === 'tag') {
    // Group operations by tag
    const operationsByTag = new Map<string, OperationInfo[]>()
    for (const op of operations) {
      const tag = op.tags[0]
      if (!operationsByTag.has(tag)) {
        operationsByTag.set(tag, [])
      }
      operationsByTag.get(tag)!.push(op)
    }

    // Build contracts object grouped by tag
    const contractsObject = $.object()
    for (const [tag, tagOps] of operationsByTag) {
      const tagKey = tag.charAt(0).toLowerCase() + tag.slice(1)
      const tagObject = $.object()
      for (const op of tagOps) {
        const contractSymbol = contractSymbols[op.id]
        if (contractSymbol) {
          const contractName = contractNameBuilder(op.id)
          tagObject.prop(contractName, $(contractSymbol))
        }
      }
      contractsObject.prop(tagKey, tagObject)
    }

    const contractsNode = $.const(contractsSymbol)
      .export()
      .assign(contractsObject)
    plugin.node(contractsNode)
  }
  else {
    // Flat structure without grouping
    const contractsObject = $.object()
    for (const op of operations) {
      const contractSymbol = contractSymbols[op.id]
      if (contractSymbol) {
        const contractName = contractNameBuilder(op.id)
        contractsObject.prop(contractName, $(contractSymbol))
      }
    }

    const contractsNode = $.const(contractsSymbol)
      .export()
      .assign(contractsObject)
    plugin.node(contractsNode)
  }

  // Create type export: export type Contracts = typeof contracts
  const contractsTypeSymbol = plugin.symbol('Contracts', {
    exported: true,
    meta: {
      category: 'type',
    },
  })

  const contractsTypeNode = $.type.alias(contractsTypeSymbol)
    .export()
    .type($.type.query($(contractsSymbol)))
  plugin.node(contractsTypeNode)
}
