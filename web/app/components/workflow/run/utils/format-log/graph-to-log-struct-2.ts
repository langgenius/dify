type NodePlain = { nodeType: 'plain'; nodeId: string }
type NodeComplex = { nodeType: string; nodeId: string; params: (NodePlain | NodeComplex | Node[])[] }
type Node = NodePlain | NodeComplex

/**
 * Parses a DSL string into an array of node objects.
 * @param dsl - The input DSL string.
 * @returns An array of parsed nodes.
 */
function parseDSL(dsl: string): Node[] {
  return parseTopLevelFlow(dsl).map(parseNode)
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
 * @returns A parsed node object.
 */
function parseNode(nodeStr: string): Node {
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
    const params = parseParams(paramsRaw)

    return {
      nodeType: nodeType.trim(),
      nodeId: nodeId.trim(),
      params,
    }
  }

  // If it's not a complex node, treat it as a plain node
  return { nodeType: 'plain', nodeId: nodeStr.trim() }
}

/**
 * Parses parameters of a complex node.
 * Supports nested flows and complex sub-nodes.
 * @param paramParts - The parameters string split by commas.
 * @returns An array of parsed parameters (plain nodes, nested nodes, or flows).
 */
function parseParams(paramParts: string[]): (Node | Node[])[] {
  return paramParts.map((part) => {
    if (part.includes('->')) {
      // Parse as a flow and return an array of nodes
      return parseTopLevelFlow(part).map(parseNode)
    }
    else if (part.startsWith('(')) {
      // Parse as a nested complex node
      return parseNode(part)
    }
    else if (!isNaN(Number(part.trim()))) {
      // Parse as a numeric parameter
      return Number(part.trim())
    }
    else {
      // Parse as a plain node
      return parseNode(part)
    }
  })
}

export { parseDSL }
