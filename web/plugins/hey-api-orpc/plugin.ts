import type { IR } from '@hey-api/openapi-ts'
import type { OrpcPlugin } from './types'

import { $ } from '@hey-api/openapi-ts'

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

// Convert kebab-case to camelCase: "chat-messages" → "chatMessages"
function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

// Extract first path segment: "/chat-messages" → "chat-messages"
function getPathSegment(path: string): string {
  return path.split('/').filter(Boolean)[0] || 'common'
}

// Simplify operation key by removing redundant parts based on the group
// e.g., "sendChatMessage" with segment "chat-messages" → "send"
// e.g., "getConversationsList" with segment "conversations" → "list"
// e.g., "uploadChatFile" with segment "files" → "upload"
function simplifyOperationKey(operationId: string, segment: string): string {
  // Patterns to remove (order matters - more specific first)
  const patternsToRemove = [
    // App-specific patterns
    'ChatWebApp',
    'ChatApp',
    'ChatFile',
    'ChatMessage',
    'Chat',
    // Segment-based patterns
    ...buildSegmentPatterns(segment),
  ]

  let simplified = operationId

  // Remove patterns iteratively
  for (const pattern of patternsToRemove) {
    const regex = new RegExp(pattern, 'g')
    const result = simplified.replace(regex, '')
    if (result !== simplified && result.length > 0) {
      simplified = result
    }
  }

  // Ensure first char is lowercase
  simplified = simplified.charAt(0).toLowerCase() + simplified.slice(1)

  // Handle edge cases where we end up with just HTTP method
  // e.g., "get" → keep as "get", but "getChatApp" → "get" is fine for single operations
  if (!simplified || simplified.length < 2) {
    return operationId.charAt(0).toLowerCase() + operationId.slice(1)
  }

  return simplified
}

// Build patterns from segment name
// "chat-messages" → ["ChatMessages", "ChatMessage"]
// "conversations" → ["Conversations", "Conversation"]
// "audio-to-text" → ["AudioToText"]
function buildSegmentPatterns(segment: string): string[] {
  const parts = segment.split('-')
  const patterns: string[] = []

  // Full camelCase: "chat-messages" → "ChatMessages"
  const fullCamel = parts.map(capitalizeFirst).join('')
  patterns.push(fullCamel)

  // Singular form: "ChatMessages" → "ChatMessage"
  if (fullCamel.endsWith('s') && !fullCamel.endsWith('ss')) {
    patterns.push(fullCamel.slice(0, -1))
  }

  return patterns
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
    zodDataSchema: toZodSchemaName(id, 'data'),
    zodResponseSchema: toZodSchemaName(id, 'response'),
  }
}

export const handler: OrpcPlugin['Handler'] = ({ plugin }) => {
  const {
    contractNameBuilder,
    defaultTag,
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
      pluginName: 'orpc',
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
        path: ['paths', op.path, op.method.toLowerCase()],
        pluginName: 'orpc',
        resource: 'operation',
        resourceId: op.id,
        tags: op.tags,
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

  // Create contracts object export grouped by API path segment
  const contractsSymbol = plugin.symbol('contracts', {
    exported: true,
    meta: {
      pluginName: 'orpc',
    },
  })

  // Group operations by path segment
  const operationsBySegment = new Map<string, OperationInfo[]>()
  for (const op of operations) {
    const segment = getPathSegment(op.path)
    if (!operationsBySegment.has(segment)) {
      operationsBySegment.set(segment, [])
    }
    operationsBySegment.get(segment)!.push(op)
  }

  // Build nested contracts object
  const contractsObject = $.object()
  for (const [segment, segmentOps] of operationsBySegment) {
    const groupKey = toCamelCase(segment)
    const groupObject = $.object()

    for (const op of segmentOps) {
      const contractSymbol = contractSymbols[op.id]
      if (contractSymbol) {
        const key = simplifyOperationKey(op.id, segment)
        groupObject.prop(key, $(contractSymbol))
      }
    }

    contractsObject.prop(groupKey, groupObject)
  }

  const contractsNode = $.const(contractsSymbol)
    .export()
    .assign(contractsObject)
  plugin.node(contractsNode)

  // Create type export: export type Contracts = typeof contracts
  const contractsTypeSymbol = plugin.symbol('Contracts', {
    exported: true,
    meta: {
      pluginName: 'orpc',
    },
  })

  const contractsTypeNode = $.type.alias(contractsTypeSymbol)
    .export()
    .type($.type.query($(contractsSymbol)))
  plugin.node(contractsTypeNode)
}
