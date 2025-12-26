/**
 * Vibe Workflow Generator Configuration
 *
 * This module centralizes configuration for the Vibe workflow generation feature,
 * including node type aliases and field name corrections.
 *
 * Note: These definitions are mirrored in the backend at:
 * api/core/llm_generator/vibe_config/node_definitions.json
 * When updating these values, also update the backend JSON file.
 */

/**
 * Node type aliases for inference from natural language.
 * Maps common terms to canonical node type names.
 */
export const NODE_TYPE_ALIASES: Record<string, string> = {
  // Start node aliases
  start: 'start',
  begin: 'start',
  input: 'start',
  // End node aliases
  end: 'end',
  finish: 'end',
  output: 'end',
  // LLM node aliases
  llm: 'llm',
  ai: 'llm',
  gpt: 'llm',
  model: 'llm',
  chat: 'llm',
  // Code node aliases
  code: 'code',
  script: 'code',
  python: 'code',
  javascript: 'code',
  // HTTP request node aliases
  'http-request': 'http-request',
  http: 'http-request',
  request: 'http-request',
  api: 'http-request',
  fetch: 'http-request',
  webhook: 'http-request',
  // Conditional node aliases
  'if-else': 'if-else',
  condition: 'if-else',
  branch: 'if-else',
  switch: 'if-else',
  // Loop node aliases
  iteration: 'iteration',
  loop: 'loop',
  foreach: 'iteration',
  // Tool node alias
  tool: 'tool',
}

/**
 * Field name corrections for LLM-generated node configs.
 * Maps incorrect field names to correct ones for specific node types.
 */
export const FIELD_NAME_CORRECTIONS: Record<string, Record<string, string>> = {
  'http-request': {
    text: 'body', // LLM might use "text" instead of "body"
    content: 'body',
    response: 'body',
  },
  code: {
    text: 'result', // LLM might use "text" instead of "result"
    output: 'result',
  },
  llm: {
    response: 'text',
    answer: 'text',
  },
}

/**
 * Correct field names based on node type.
 * LLM sometimes generates wrong field names (e.g., "text" instead of "body" for HTTP nodes).
 *
 * @param field - The field name to correct
 * @param nodeType - The type of the node
 * @returns The corrected field name, or the original if no correction needed
 */
export const correctFieldName = (field: string, nodeType: string): string => {
  const corrections = FIELD_NAME_CORRECTIONS[nodeType]
  if (corrections && corrections[field])
    return corrections[field]
  return field
}

/**
 * Get the canonical node type from an alias.
 *
 * @param alias - The alias to look up
 * @returns The canonical node type, or undefined if not found
 */
export const getCanonicalNodeType = (alias: string): string | undefined => {
  return NODE_TYPE_ALIASES[alias.toLowerCase()]
}

