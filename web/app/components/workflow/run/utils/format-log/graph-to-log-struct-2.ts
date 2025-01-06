type IterationInfo = { iterationId: string; iterationIndex: number }
type NodePlain = { nodeType: 'plain'; nodeId: string; } & Partial<IterationInfo>
type NodeComplex = { nodeType: string; nodeId: string; params: (NodePlain | (NodeComplex & Partial<IterationInfo>) | Node[] | number)[] } & Partial<IterationInfo>
type Node = NodePlain | NodeComplex

/**
 * Parses a DSL string into an array of node objects.
 * @param dsl - The input DSL string.
 * @returns An array of parsed nodes.
 */
function parseDSL(dsl: string): Node[] {
  return parseTopLevelFlow(dsl).map(nodeStr => parseNode(nodeStr))
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
    if (char === '(') nested++
    if (char === ')') nested--
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
 * @returns A parsed node object.
 */
function parseNode(nodeStr: string, parentIterationId?: string): Node {
  // Check if the node is a complex node
  if (nodeStr.startsWith('(') && nodeStr.endsWith(')')) {
    const innerContent = nodeStr.slice(1, -1).trim() // Remove outer parentheses
    let nested = 0
    let buffer = ''
    const parts: string[] = []

    // Split the inner content by commas, respecting nested parentheses
    for (let i = 0; i < innerContent.length; i++) {
      const char = innerContent[i]
      if (char === '(') nested++
      if (char === ')') nested--

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
    const params = parseParams(paramsRaw, nodeType === 'iteration' ? nodeId.trim() : parentIterationId)
    const complexNode = {
      nodeType: nodeType.trim(),
      nodeId: nodeId.trim(),
      params,
    }
    if (parentIterationId) {
      complexNode.iterationId = parentIterationId
      complexNode.iterationIndex = 0 // Fixed as 0
    }
    return complexNode
  }

  // If it's not a complex node, treat it as a plain node
  const plainNode: NodePlain = { nodeType: 'plain', nodeId: nodeStr.trim() }
  if (parentIterationId) {
    plainNode.iterationId = parentIterationId
    plainNode.iterationIndex = 0 // Fixed as 0
  }
  return plainNode
}

/**
 * Parses parameters of a complex node.
 * Supports nested flows and complex sub-nodes.
 * Adds iteration-specific metadata recursively.
 * @param paramParts - The parameters string split by commas.
 * @param iterationId - The ID of the iteration node, if applicable.
 * @returns An array of parsed parameters (plain nodes, nested nodes, or flows).
 */
function parseParams(paramParts: string[], iterationId?: string): (Node | Node[] | number)[] {
  return paramParts.map((part) => {
    if (part.includes('->')) {
      // Parse as a flow and return an array of nodes
      return parseTopLevelFlow(part).map(node => parseNode(node, iterationId))
    }
    else if (part.startsWith('(')) {
      // Parse as a nested complex node
      return parseNode(part, iterationId)
    }
    else if (!Number.isNaN(Number(part.trim()))) {
      // Parse as a numeric parameter
      return Number(part.trim())
    }
    else {
      // Parse as a plain node
      return parseNode(part, iterationId)
    }
  })
}

export { parseDSL }
