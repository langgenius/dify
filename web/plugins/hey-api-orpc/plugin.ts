import type { IR } from '@hey-api/openapi-ts'
import type { OrpcPlugin } from './types'

import { $ } from '@hey-api/openapi-ts'

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
}

function collectOperation(operation: IR.OperationObject, defaultTag: string): OperationInfo {
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
    tags: operation.tags && operation.tags.length > 0 ? [...operation.tags] : [defaultTag],
  }
}

export const handler: OrpcPlugin['Handler'] = ({ plugin }) => {
  const {
    contractNameBuilder,
    defaultTag,
    groupKeyBuilder,
    operationKeyBuilder,
  } = plugin.config

  const operations: OperationInfo[] = []

  // Collect all operations using hey-api's forEach
  plugin.forEach('operation', (event) => {
    const info = collectOperation(event.operation, defaultTag)
    operations.push(info)
  })

  // Register external symbols for imports
  const symbolOc = plugin.symbol('oc', {
    exported: false,
    external: '@orpc/contract',
  })
  const symbolZ = plugin.external('zod.z')

  // Create base contract symbol
  const baseSymbol = plugin.symbol('base', {
    exported: true,
    meta: {
      category: 'contract',
      resource: 'base',
      tool: 'orpc',
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
        category: 'contract',
        path: ['paths', op.path, op.method.toLowerCase()],
        resource: 'operation',
        resourceId: op.id,
        role: 'contract',
        tags: op.tags,
        tool: 'orpc',
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
      // Reference zod schema symbol dynamically from zod plugin
      const zodDataSymbol = plugin.referenceSymbol({
        category: 'schema',
        resource: 'operation',
        resourceId: op.id,
        role: 'data',
        tool: 'zod',
      })
      expression = expression
        .attr('input')
        .call($(zodDataSymbol))
    }

    // .output(z.object({ body: zodResponseSchema, status: z.literal(200) })) if has output (detailed outputStructure)
    if (op.hasOutput) {
      // Reference zod response schema symbol dynamically from zod plugin
      const zodResponseSymbol = plugin.referenceSymbol({
        category: 'schema',
        resource: 'operation',
        resourceId: op.id,
        role: 'responses',
        tool: 'zod',
      })
      const outputObject = $.object()
        .prop('body', $(zodResponseSymbol))

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

  // Create contracts object export grouped by API path segment (in separate router file)
  const contractsSymbol = plugin.symbol('router', {
    exported: true,
    meta: {
      category: 'contract',
      resource: 'router',
      tool: 'orpc',
    },
  })

  // Group operations by group key
  const operationsByGroup = new Map<string, OperationInfo[]>()
  for (const op of operations) {
    const groupKey = groupKeyBuilder(op.path)
    if (!operationsByGroup.has(groupKey)) {
      operationsByGroup.set(groupKey, [])
    }
    operationsByGroup.get(groupKey)!.push(op)
  }

  // Build nested contracts object
  const contractsObject = $.object()
  for (const [groupKey, groupOps] of operationsByGroup) {
    const groupObject = $.object()

    for (const op of groupOps) {
      const contractSymbol = contractSymbols[op.id]
      if (contractSymbol) {
        const key = operationKeyBuilder(op.id, groupKey)
        groupObject.prop(key, $(contractSymbol))
      }
    }

    contractsObject.prop(groupKey, groupObject)
  }

  const contractsNode = $.const(contractsSymbol)
    .export()
    .assign(contractsObject)
  plugin.node(contractsNode)

  // Create type export: export type Router = typeof router (in separate router file)
  const routerTypeSymbol = plugin.symbol('Router', {
    exported: true,
    meta: {
      category: 'type',
      resource: 'router',
      tool: 'orpc',
    },
  })

  const routerTypeNode = $.type.alias(routerTypeSymbol)
    .export()
    .type($.type.query($(contractsSymbol)))
  plugin.node(routerTypeNode)
}
