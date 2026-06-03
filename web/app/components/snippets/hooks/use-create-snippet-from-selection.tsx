import type { Edge, Node, ValueSelector } from '@/app/components/workflow/types'
import type { SnippetCanvasData, SnippetInputField } from '@/models/snippet'
import { useCallback, useState } from 'react'
import { getNodesBounds } from 'reactflow'
import CreateSnippetDialog from '@/app/components/snippets/create-snippet-dialog'
import { SNIPPET_INPUT_FIELD_NODE_ID } from '@/app/components/workflow/nodes/_base/hooks/snippet-input-field-vars'
import { PipelineInputVarType } from '@/models/pipeline'
import { useCreateSnippet } from './use-create-snippet'

const DEFAULT_SNIPPET_VIEWPORT = { x: 0, y: 0, zoom: 1 }
const SNIPPET_VIEWPORT_WIDTH = 1200
const SNIPPET_VIEWPORT_HEIGHT = 800
const SNIPPET_VIEWPORT_PADDING = 160
const VARIABLE_REFERENCE_REGEX = /\{\{#([^#{}]+)#\}\}/g
const RESERVED_VARIABLE_PREFIXES = new Set(['rag'])

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const isValueSelector = (value: unknown): value is ValueSelector => {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item => typeof item === 'string')
}

const isSelectorKey = (key?: string) => {
  return key === 'selector' || !!key?.endsWith('_selector')
}

const isValueSelectorListKey = (key?: string) => {
  return key === 'variables'
}

const isValueSelectorList = (value: unknown[]) => {
  return value.length > 0 && value.every(isValueSelector)
}

const isContextPlaceholderSelector = (selector: ValueSelector) => {
  return (selector.length === 1 && selector[0] === 'context')
    || selector.at(-1) === '#context#'
}

const getCenteredViewport = (nodes: Node[]) => {
  if (!nodes.length)
    return DEFAULT_SNIPPET_VIEWPORT

  const bounds = getNodesBounds(nodes)
  if (!bounds.width || !bounds.height)
    return DEFAULT_SNIPPET_VIEWPORT

  const zoom = Math.min(
    (SNIPPET_VIEWPORT_WIDTH - SNIPPET_VIEWPORT_PADDING * 2) / bounds.width,
    (SNIPPET_VIEWPORT_HEIGHT - SNIPPET_VIEWPORT_PADDING * 2) / bounds.height,
    1,
  )
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2

  return {
    x: SNIPPET_VIEWPORT_WIDTH / 2 - centerX * zoom,
    y: SNIPPET_VIEWPORT_HEIGHT / 2 - centerY * zoom,
    zoom,
  }
}

const collectSelectorsFromText = (value: string, selectors: ValueSelector[]) => {
  for (const match of value.matchAll(VARIABLE_REFERENCE_REGEX)) {
    const variablePath = match[1]
    if (!variablePath)
      continue

    const selector = variablePath.split('.').filter(Boolean)
    if (selector.length > 0 && !isContextPlaceholderSelector(selector))
      selectors.push(selector)
  }
}

const collectVariableSelectors = (
  value: unknown,
  selectors: ValueSelector[],
  key?: string,
) => {
  if (typeof value === 'string') {
    collectSelectorsFromText(value, selectors)
    return
  }

  if (Array.isArray(value)) {
    if (isSelectorKey(key) && isValueSelector(value))
      selectors.push(value)

    if (isValueSelectorListKey(key) && isValueSelectorList(value)) {
      value.forEach(selector => selectors.push(selector))
      return
    }

    value.forEach(item => collectVariableSelectors(item, selectors))
    return
  }

  if (!isRecord(value))
    return

  Object.entries(value).forEach(([currentKey, currentValue]) => {
    collectVariableSelectors(currentValue, selectors, currentKey)
  })
}

const isExternalVariableSelector = (
  selector: ValueSelector,
  selectedNodeIds: Set<string>,
) => {
  const nodeId = selector[0]
  if (!nodeId)
    return false

  if (nodeId.startsWith('$'))
    return false

  if (isContextPlaceholderSelector(selector))
    return false

  if (selectedNodeIds.has(nodeId))
    return false

  return !RESERVED_VARIABLE_PREFIXES.has(nodeId)
}

const sanitizeInputFieldVariable = (variable: string) => {
  const sanitized = variable.replace(/\W/g, '_')
  if (!sanitized)
    return 'input'

  if (/^\d/.test(sanitized))
    return `input_${sanitized}`

  return sanitized
}

const getUniqueInputFieldVariable = (
  selector: ValueSelector,
  usedVariables: Set<string>,
) => {
  const baseVariable = sanitizeInputFieldVariable(selector.at(-1) ?? 'input')
  let variable = baseVariable
  let index = 2

  while (usedVariables.has(variable)) {
    variable = `${baseVariable}_${index}`
    index += 1
  }

  usedVariables.add(variable)
  return variable
}

const getInputFieldType = (selector: ValueSelector) => {
  const variable = selector.at(-1)
  if (variable === 'files')
    return PipelineInputVarType.multiFiles

  return PipelineInputVarType.textInput
}

const getExternalVariableInputFields = (
  nodes: Node[],
  selectedNodeIds: Set<string>,
) => {
  const selectors: ValueSelector[] = []
  nodes.forEach(node => collectVariableSelectors(node.data, selectors))

  const usedVariables = new Set<string>()
  const fieldBySelector = new Map<string, SnippetInputField>()

  selectors.forEach((selector) => {
    if (!isExternalVariableSelector(selector, selectedNodeIds))
      return

    const selectorKey = selector.join('.')
    if (fieldBySelector.has(selectorKey))
      return

    const variable = getUniqueInputFieldVariable(selector, usedVariables)
    fieldBySelector.set(selectorKey, {
      label: variable,
      variable,
      type: getInputFieldType(selector),
      required: true,
    })
  })

  return {
    inputFields: [...fieldBySelector.values()],
    selectorMap: new Map(
      [...fieldBySelector.entries()].map(([selectorKey, field]) => [
        selectorKey,
        [SNIPPET_INPUT_FIELD_NODE_ID, field.variable] satisfies ValueSelector,
      ]),
    ),
  }
}

const rewriteVariableReferences = (
  value: unknown,
  selectorMap: Map<string, ValueSelector>,
  key?: string,
): unknown => {
  if (typeof value === 'string') {
    return value.replace(VARIABLE_REFERENCE_REGEX, (match, variablePath: string) => {
      const nextSelector = selectorMap.get(variablePath)
      if (!nextSelector)
        return match

      return `{{#${nextSelector.join('.')}#}}`
    })
  }

  if (Array.isArray(value)) {
    if (isSelectorKey(key) && isValueSelector(value)) {
      const nextSelector = selectorMap.get(value.join('.'))
      if (nextSelector)
        return nextSelector
    }

    if (isValueSelectorListKey(key) && isValueSelectorList(value)) {
      return value.map((selector) => {
        const nextSelector = selectorMap.get(selector.join('.'))
        return nextSelector || selector
      })
    }

    return value.map(item => rewriteVariableReferences(item, selectorMap))
  }

  if (!isRecord(value))
    return value

  return Object.fromEntries(
    Object.entries(value).map(([currentKey, currentValue]) => [
      currentKey,
      rewriteVariableReferences(currentValue, selectorMap, currentKey),
    ]),
  )
}

const getSelectedSnippetGraph = (selectedNodes: Node[], edges: Edge[]) => {
  const selectedNodeIds = new Set(selectedNodes.map(node => node.id))
  const {
    inputFields,
    selectorMap,
  } = getExternalVariableInputFields(selectedNodes, selectedNodeIds)
  const nodes = selectedNodes.map(node => ({
    ...node,
    data: rewriteVariableReferences(node.data, selectorMap) as Node['data'],
    selected: false,
  }))

  return {
    graph: {
      nodes,
      edges: edges
        .filter(edge => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target))
        .map(edge => ({
          ...edge,
          selected: false,
        })),
      viewport: getCenteredViewport(nodes),
    } satisfies SnippetCanvasData,
    inputFields,
  }
}

type UseCreateSnippetFromSelectionParams = {
  edges: Edge[]
  selectedNodes: Node[]
  onClose: () => void
}

export const useCreateSnippetFromSelection = ({
  edges,
  selectedNodes,
  onClose,
}: UseCreateSnippetFromSelectionParams) => {
  const [selectedSnippetGraph, setSelectedSnippetGraph] = useState<SnippetCanvasData>()
  const [selectedSnippetInputFields, setSelectedSnippetInputFields] = useState<SnippetInputField[]>([])
  const {
    createSnippetMutation,
    handleCloseCreateSnippetDialog,
    handleCreateSnippet,
    handleOpenCreateSnippetDialog,
    isCreateSnippetDialogOpen,
    isCreatingSnippet,
  } = useCreateSnippet()

  const handleOpenCreateSnippet = useCallback(() => {
    const {
      graph,
      inputFields,
    } = getSelectedSnippetGraph(selectedNodes, edges)
    setSelectedSnippetGraph(graph)
    setSelectedSnippetInputFields(inputFields)
    handleOpenCreateSnippetDialog()
    onClose()
  }, [edges, handleOpenCreateSnippetDialog, onClose, selectedNodes])

  const handleCloseCreateSnippet = useCallback(() => {
    setSelectedSnippetGraph(undefined)
    setSelectedSnippetInputFields([])
    handleCloseCreateSnippetDialog()
  }, [handleCloseCreateSnippetDialog])

  const createSnippetDialog = (
    <CreateSnippetDialog
      isOpen={isCreateSnippetDialogOpen}
      selectedGraph={selectedSnippetGraph}
      inputFields={selectedSnippetInputFields}
      isSubmitting={isCreatingSnippet || createSnippetMutation.isPending}
      onClose={handleCloseCreateSnippet}
      onConfirm={handleCreateSnippet}
    />
  )

  return {
    createSnippetDialog,
    handleOpenCreateSnippet,
    isCreateSnippetDialogOpen,
  }
}
