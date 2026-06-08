import type { Edge, Node } from '../types'

const WORKFLOW_CLIPBOARD_KIND = 'dify-workflow-clipboard'

type WorkflowClipboardPayload = {
  kind: string
  version: string
  nodes: Node[]
  edges: Edge[]
}

type WorkflowClipboardData = {
  nodes: Node[]
  edges: Edge[]
}

type WorkflowClipboardReadResult = WorkflowClipboardData & {
  sourceVersion?: string
  isVersionMismatch: boolean
}

const emptyClipboardData: WorkflowClipboardData = {
  nodes: [],
  edges: [],
}

const emptyClipboardReadResult: WorkflowClipboardReadResult = {
  ...emptyClipboardData,
  isVersionMismatch: false,
}

const isNodeArray = (value: unknown): value is Node[] => Array.isArray(value)
const isEdgeArray = (value: unknown): value is Edge[] => Array.isArray(value)
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const sanitizeClipboardValueByDefault = (defaultValue: unknown, incomingValue: unknown): unknown => {
  if (defaultValue === undefined)
    return incomingValue

  if (Array.isArray(defaultValue))
    return Array.isArray(incomingValue) ? incomingValue : [...defaultValue]

  if (isPlainObject(defaultValue)) {
    if (!isPlainObject(incomingValue)) {
      return Object.fromEntries(
        Object.entries(defaultValue).map(([key, value]) => [
          key,
          sanitizeClipboardValueByDefault(value, undefined),
        ]),
      )
    }

    const merged: Record<string, unknown> = {}
    const keys = new Set([
      ...Object.keys(defaultValue),
      ...Object.keys(incomingValue),
    ])

    keys.forEach((key) => {
      const hasDefault = Object.hasOwn(defaultValue, key)
      const hasIncoming = Object.hasOwn(incomingValue, key)
      if (hasDefault && hasIncoming) {
        merged[key] = sanitizeClipboardValueByDefault(
          defaultValue[key],
          incomingValue[key],
        )
        return
      }

      if (hasIncoming) {
        merged[key] = incomingValue[key]
        return
      }

      merged[key] = sanitizeClipboardValueByDefault(defaultValue[key], undefined)
    })

    return merged
  }

  if (typeof defaultValue === 'number')
    return typeof incomingValue === 'number' && Number.isFinite(incomingValue) ? incomingValue : defaultValue

  return typeof incomingValue === typeof defaultValue ? incomingValue : defaultValue
}

export const isClipboardValueCompatibleWithDefault = (defaultValue: unknown, incomingValue: unknown): boolean => {
  if (incomingValue === undefined)
    return true

  if (defaultValue === undefined)
    return true

  if (Array.isArray(defaultValue))
    return Array.isArray(incomingValue)

  if (isPlainObject(defaultValue)) {
    if (!isPlainObject(incomingValue))
      return false

    return Object.entries(defaultValue).every(([key, value]) => {
      return isClipboardValueCompatibleWithDefault(
        value,
        incomingValue[key],
      )
    })
  }

  if (typeof defaultValue === 'number')
    return typeof incomingValue === 'number' && Number.isFinite(incomingValue)

  return typeof incomingValue === typeof defaultValue
}

export const isClipboardNodeStructurallyValid = (value: unknown): value is Node => {
  if (!isPlainObject(value))
    return false

  if (typeof value.id !== 'string' || typeof value.type !== 'string')
    return false

  if (!isPlainObject(value.data) || !isPlainObject(value.position))
    return false

  return Number.isFinite(value.position.x) && Number.isFinite(value.position.y)
}

export const isClipboardEdgeStructurallyValid = (value: unknown): value is Edge => {
  if (!isPlainObject(value))
    return false

  return typeof value.id === 'string'
    && typeof value.source === 'string'
    && typeof value.target === 'string'
}

export const parseWorkflowClipboardText = (
  text: string,
  currentClipboardVersion: string,
): WorkflowClipboardReadResult => {
  if (!text)
    return emptyClipboardReadResult

  try {
    const parsed = JSON.parse(text) as Partial<WorkflowClipboardPayload>
    if (
      parsed.kind !== WORKFLOW_CLIPBOARD_KIND
      || typeof parsed.version !== 'string'
      || !isNodeArray(parsed.nodes)
      || !isEdgeArray(parsed.edges)
    ) {
      return emptyClipboardReadResult
    }

    const sourceVersion = parsed.version

    const validatedNodes = parsed.nodes.filter(isClipboardNodeStructurallyValid)
    const validatedEdges = parsed.edges.filter(isClipboardEdgeStructurallyValid)

    return {
      nodes: validatedNodes,
      edges: validatedEdges,
      sourceVersion,
      isVersionMismatch: sourceVersion !== currentClipboardVersion,
    }
  }
  catch {
    return emptyClipboardReadResult
  }
}

export const stringifyWorkflowClipboardData = (
  payload: WorkflowClipboardData,
  currentClipboardVersion: string,
): string => {
  const data: WorkflowClipboardPayload = {
    kind: WORKFLOW_CLIPBOARD_KIND,
    version: currentClipboardVersion,
    nodes: payload.nodes,
    edges: payload.edges,
  }

  return JSON.stringify(data)
}

export const writeWorkflowClipboard = async (
  payload: WorkflowClipboardData,
  currentClipboardVersion: string,
): Promise<void> => {
  const text = stringifyWorkflowClipboardData(payload, currentClipboardVersion)
  await navigator.clipboard.writeText(text)
}

export const readWorkflowClipboard = async (
  currentClipboardVersion: string,
): Promise<WorkflowClipboardReadResult> => {
  try {
    const text = await navigator.clipboard.readText()
    return parseWorkflowClipboardText(text, currentClipboardVersion)
  }
  catch {
    return emptyClipboardReadResult
  }
}
