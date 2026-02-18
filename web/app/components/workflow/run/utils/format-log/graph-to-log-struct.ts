type IterationInfo = { iterationId: string, iterationIndex: number }
type LoopInfo = { loopId: string, loopIndex: number }
type NodePlain = { nodeType: 'plain', nodeId: string } & (Partial<IterationInfo> & Partial<LoopInfo>)
type NodeComplex = { nodeType: string, nodeId: string, params: (NodePlain | (NodeComplex & (Partial<IterationInfo> & Partial<LoopInfo>)) | Node[] | number)[] } & (Partial<IterationInfo> & Partial<LoopInfo>)
type Node = NodePlain | NodeComplex

/**
 * Parses a DSL string into an array of node objects.
 * @param dsl - The input DSL string.
 * @returns An array of parsed nodes.
 */
function parseDSL(dsl: string): NodeData[] {
  return convertToNodeData(parseTopLevelFlow(dsl).map(nodeStr => parseNode(nodeStr)))
}

/**
 * Splits a top-level flow string by "->", respecting nested structures.
 * @param dsl - The DSL string to split.
 * @returns An array of top-level segments.
 */
function parseTopLevelFlow(dsl: string): string[] {
  const segments: string[] = []
  let buffer = ''
  let nested = 0

  for (let i = 0; i < dsl.length; i++) {
    const char = dsl[i]
    if (char === '(')
      nested++
    if (char === ')')
      nested--
    if (char === '-' && dsl[i + 1] === '>' && nested === 0) {
      segments.push(buffer.trim())
      buffer = ''
      i++ // Skip the ">" character
    }
    else {
      buffer += char
    }
  }
  if (buffer.trim())
    segments.push(buffer.trim())

  return segments
}

/**
 * Parses a single node string.
 * If the node is complex (e.g., has parentheses), it extracts the node type, node ID, and parameters.
 * @param nodeStr - The node string to parse.
 * @param parentIterationId - The ID of the parent iteration node (if applicable).
 * @param parentLoopId - The ID of the parent loop node (if applicable).
 * @returns A parsed node object.
 */
function parseNode(nodeStr: string, parentIterationId?: string, parentLoopId?: string): Node {
  // Check if the node is a complex node
  if (nodeStr.startsWith('(') && nodeStr.endsWith(')')) {
    const innerContent = nodeStr.slice(1, -1).trim() // Remove outer parentheses
    let nested = 0
    let buffer = ''
    const parts: string[] = []

    // Split the inner content by commas, respecting nested parentheses
    for (let i = 0; i < innerContent.length; i++) {
      const char = innerContent[i]
      if (char === '(')
        nested++
      if (char === ')')
        nested--

      if (char === ',' && nested === 0) {
        parts.push(buffer.trim())
        buffer = ''
      }
      else {
        buffer += char
      }
    }
    parts.push(buffer.trim())

    // Extract nodeType, nodeId, and params
    const [nodeType, nodeId, ...paramsRaw] = parts
    const params = parseParams(paramsRaw, nodeType === 'iteration' ? nodeId.trim() : parentIterationId, nodeType === 'loop' ? nodeId.trim() : parentLoopId)
    const complexNode = {
      nodeType: nodeType.trim(),
      nodeId: nodeId.trim(),
      params,
    }
    if (parentIterationId) {
      (complexNode as any).iterationId = parentIterationId;
      (complexNode as any).iterationIndex = 0 // Fixed as 0
    }
    if (parentLoopId) {
      (complexNode as any).loopId = parentLoopId;
      (complexNode as any).loopIndex = 0 // Fixed as 0
    }
    return complexNode
  }

  // If it's not a complex node, treat it as a plain node
  const plainNode: NodePlain = { nodeType: 'plain', nodeId: nodeStr.trim() }
  if (parentIterationId) {
    plainNode.iterationId = parentIterationId
    plainNode.iterationIndex = 0 // Fixed as 0
  }
  if (parentLoopId) {
    plainNode.loopId = parentLoopId
    plainNode.loopIndex = 0 // Fixed as 0
  }
  return plainNode
}

/**
 * Parses parameters of a complex node.
 * Supports nested flows and complex sub-nodes.
 * Adds iteration-specific metadata recursively.
 * @param paramParts - The parameters string split by commas.
 * @param parentIterationId - The ID of the parent iteration node (if applicable).
 * @param parentLoopId - The ID of the parent loop node (if applicable).
 * @returns An array of parsed parameters (plain nodes, nested nodes, or flows).
 */
function parseParams(paramParts: string[], parentIteration?: string, parentLoopId?: string): (Node | Node[] | number)[] {
  return paramParts.map((part) => {
    if (part.includes('->')) {
      // Parse as a flow and return an array of nodes
      return parseTopLevelFlow(part).map(node => parseNode(node, parentIteration || undefined, parentLoopId || undefined))
    }
    else if (part.startsWith('(')) {
      // Parse as a nested complex node
      return parseNode(part, parentIteration || undefined, parentLoopId || undefined)
    }
    else if (!Number.isNaN(Number(part.trim()))) {
      // Parse as a numeric parameter
      return Number(part.trim())
    }
    else {
      // Parse as a plain node
      return parseNode(part, parentIteration || undefined, parentLoopId || undefined)
    }
  })
}

type NodeData = {
  id: string
  node_id: string
  title: string
  node_type?: string
  execution_metadata: Record<string, any>
  status: string
}

/**
 * Converts a plain node to node data.
 */
function convertPlainNode(node: Node): NodeData[] {
  return [
    {
      id: node.nodeId,
      node_id: node.nodeId,
      title: node.nodeId,
      execution_metadata: {},
      status: 'succeeded',
    },
  ]
}

/**
 * Converts a retry node to node data.
 */
function convertRetryNode(node: Node): NodeData[] {
  const { nodeId, iterationId, iterationIndex, loopId, loopIndex, params } = node as NodeComplex
  const retryCount = params ? Number.parseInt(params[0] as unknown as string, 10) : 0
  const result: NodeData[] = [
    {
      id: nodeId,
      node_id: nodeId,
      title: nodeId,
      execution_metadata: {},
      status: 'succeeded',
    },
  ]

  for (let i = 0; i < retryCount; i++) {
    result.push({
      id: nodeId,
      node_id: nodeId,
      title: nodeId,
      execution_metadata: iterationId
        ? {
            iteration_id: iterationId,
            iteration_index: iterationIndex || 0,
          }
        : loopId
          ? {
              loop_id: loopId,
              loop_index: loopIndex || 0,
            }
          : {},
      status: 'retry',
    })
  }

  return result
}

/**
 * Converts an iteration node to node data.
 */
function convertIterationNode(node: Node): NodeData[] {
  const { nodeId, params } = node as NodeComplex
  const result: NodeData[] = [
    {
      id: nodeId,
      node_id: nodeId,
      title: nodeId,
      node_type: 'iteration',
      status: 'succeeded',
      execution_metadata: {},
    },
  ]

  params?.forEach((param: any) => {
    if (Array.isArray(param)) {
      param.forEach((childNode: Node) => {
        const childData = convertToNodeData([childNode])
        childData.forEach((data) => {
          data.execution_metadata = {
            ...data.execution_metadata,
            iteration_id: nodeId,
            iteration_index: 0,
          }
        })
        result.push(...childData)
      })
    }
  })

  return result
}

/**
 * Converts an loop node to node data.
 */
function convertLoopNode(node: Node): NodeData[] {
  const { nodeId, params } = node as NodeComplex
  const result: NodeData[] = [
    {
      id: nodeId,
      node_id: nodeId,
      title: nodeId,
      node_type: 'loop',
      status: 'succeeded',
      execution_metadata: {},
    },
  ]

  params?.forEach((param: any) => {
    if (Array.isArray(param)) {
      param.forEach((childNode: Node) => {
        const childData = convertToNodeData([childNode])
        childData.forEach((data) => {
          data.execution_metadata = {
            ...data.execution_metadata,
            loop_id: nodeId,
            loop_index: 0,
          }
        })
        result.push(...childData)
      })
    }
  })

  return result
}

/**
 * Converts a parallel node to node data.
 */
function convertParallelNode(node: Node, parentParallelId?: string, parentStartNodeId?: string): NodeData[] {
  const { nodeId, params } = node as NodeComplex
  const result: NodeData[] = [
    {
      id: nodeId,
      node_id: nodeId,
      title: nodeId,
      execution_metadata: {
        parallel_id: nodeId,
      },
      status: 'succeeded',
    },
  ]

  params?.forEach((param) => {
    if (Array.isArray(param)) {
      const startNodeId = param[0]?.nodeId
      param.forEach((childNode: Node) => {
        const childData = convertToNodeData([childNode])
        childData.forEach((data) => {
          data.execution_metadata = {
            ...data.execution_metadata,
            parallel_id: nodeId,
            parallel_start_node_id: startNodeId,
            ...(parentParallelId && {
              parent_parallel_id: parentParallelId,
              parent_parallel_start_node_id: parentStartNodeId,
            }),
          }
        })
        result.push(...childData)
      })
    }
    else if (param && typeof param === 'object') {
      const startNodeId = param.nodeId
      const childData = convertToNodeData([param])
      childData.forEach((data) => {
        data.execution_metadata = {
          ...data.execution_metadata,
          parallel_id: nodeId,
          parallel_start_node_id: startNodeId,
          ...(parentParallelId && {
            parent_parallel_id: parentParallelId,
            parent_parallel_start_node_id: parentStartNodeId,
          }),
        }
      })
      result.push(...childData)
    }
  })

  return result
}

/**
 * Main function to convert nodes to node data.
 */
function convertToNodeData(nodes: Node[], parentParallelId?: string, parentStartNodeId?: string): NodeData[] {
  const result: NodeData[] = []

  nodes.forEach((node) => {
    switch (node.nodeType) {
      case 'plain':
        result.push(...convertPlainNode(node))
        break
      case 'retry':
        result.push(...convertRetryNode(node))
        break
      case 'iteration':
        result.push(...convertIterationNode(node))
        break
      case 'loop':
        result.push(...convertLoopNode(node))
        break
      case 'parallel':
        result.push(...convertParallelNode(node, parentParallelId, parentStartNodeId))
        break
      default:
        throw new Error(`Unknown nodeType: ${node.nodeType}`)
    }
  })

  return result
}

export default parseDSL
