import type { CreateSnippetDialogPayload } from './create-snippet-dialog'
import type { Edge, Node } from './types'
import type { SnippetCanvasData } from '@/models/snippet'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@langgenius/dify-ui/context-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { produce } from 'immer'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { getNodesBounds, useStore as useReactFlowStore, useStoreApi } from 'reactflow'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import { useSnippetAndEvaluationPlanAccess } from '@/hooks/use-snippet-and-evaluation-plan-access'
import { useRouter } from '@/next/navigation'
import { consoleClient } from '@/service/client'
import { useCreateSnippetMutation } from '@/service/use-snippets'
import CreateSnippetDialog from './create-snippet-dialog'
import { useNodesInteractions, useNodesReadOnly, useNodesSyncDraft } from './hooks'
import { useSelectionInteractions } from './hooks/use-selection-interactions'
import { useWorkflowHistory, WorkflowHistoryEvent } from './hooks/use-workflow-history'
import type { WorkflowShortcutId } from './shortcuts/definitions'
import { ShortcutKbd } from './shortcuts/shortcut-kbd'
import { useStore, useWorkflowStore } from './store'
import { BlockEnum, TRIGGER_NODE_TYPES } from './types'

const AlignType = {
  Bottom: 'bottom',
  Center: 'center',
  DistributeHorizontal: 'distributeHorizontal',
  DistributeVertical: 'distributeVertical',
  Left: 'left',
  Middle: 'middle',
  Right: 'right',
  Top: 'top',
} as const

type AlignTypeValue = (typeof AlignType)[keyof typeof AlignType]

type AlignBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type AlignMenuItem = {
  alignType: AlignTypeValue
  icon: string
  iconClassName?: string
  translationKey: string
}

type ActionMenuItem = {
  action: 'copy' | 'createSnippet' | 'delete' | 'duplicate'
  disabled?: boolean
  shortcut?: WorkflowShortcutId
  translationKey: string
}

const DEFAULT_SNIPPET_VIEWPORT: SnippetCanvasData['viewport'] = { x: 0, y: 0, zoom: 1 }
const SNIPPET_VIEWPORT_PADDING = 100

const alignMenuItems: AlignMenuItem[] = [
  { alignType: AlignType.Left, icon: 'i-ri-align-item-left-line', translationKey: 'operator.alignLeft' },
  { alignType: AlignType.Center, icon: 'i-ri-align-item-horizontal-center-line', translationKey: 'operator.alignCenter' },
  { alignType: AlignType.Right, icon: 'i-ri-align-item-right-line', translationKey: 'operator.alignRight' },
  { alignType: AlignType.Top, icon: 'i-ri-align-item-top-line', translationKey: 'operator.alignTop' },
  { alignType: AlignType.Middle, icon: 'i-ri-align-item-vertical-center-line', iconClassName: 'rotate-90', translationKey: 'operator.alignMiddle' },
  { alignType: AlignType.Bottom, icon: 'i-ri-align-item-bottom-line', translationKey: 'operator.alignBottom' },
  { alignType: AlignType.DistributeHorizontal, icon: 'i-custom-vender-line-others-dhs', translationKey: 'operator.distributeHorizontal' },
  { alignType: AlignType.DistributeVertical, icon: 'i-custom-vender-line-others-dvs', iconClassName: 'rotate-90', translationKey: 'operator.distributeVertical' },
]

const getAlignableNodes = (nodes: Node[], selectedNodes: Node[]) => {
  const selectedNodeIds = new Set(selectedNodes.map(node => node.id))
  const childNodeIds = new Set<string>()

  nodes.forEach((node) => {
    if (!node.data._children?.length || !selectedNodeIds.has(node.id))
      return

    node.data._children.forEach((child) => {
      childNodeIds.add(child.nodeId)
    })
  })

  return nodes.filter(node => selectedNodeIds.has(node.id) && !childNodeIds.has(node.id))
}

const getAlignBounds = (nodes: Node[]): AlignBounds | null => {
  const validNodes = nodes.filter(node => node.width && node.height)
  if (validNodes.length <= 1)
    return null

  return validNodes.reduce<AlignBounds>((bounds, node) => {
    const width = node.width!
    const height = node.height!

    return {
      minX: Math.min(bounds.minX, node.position.x),
      maxX: Math.max(bounds.maxX, node.position.x + width),
      minY: Math.min(bounds.minY, node.position.y),
      maxY: Math.max(bounds.maxY, node.position.y + height),
    }
  }, {
    minX: Number.MAX_SAFE_INTEGER,
    maxX: Number.MIN_SAFE_INTEGER,
    minY: Number.MAX_SAFE_INTEGER,
    maxY: Number.MIN_SAFE_INTEGER,
  })
}

const alignNodePosition = (
  currentNode: Node,
  nodeToAlign: Node,
  alignType: AlignTypeValue,
  bounds: AlignBounds,
) => {
  const width = nodeToAlign.width ?? 0
  const height = nodeToAlign.height ?? 0

  switch (alignType) {
    case AlignType.Left:
      currentNode.position.x = bounds.minX
      if (currentNode.positionAbsolute)
        currentNode.positionAbsolute.x = bounds.minX
      break
    case AlignType.Center: {
      const centerX = bounds.minX + (bounds.maxX - bounds.minX) / 2 - width / 2
      currentNode.position.x = centerX
      if (currentNode.positionAbsolute)
        currentNode.positionAbsolute.x = centerX
      break
    }
    case AlignType.Right: {
      const rightX = bounds.maxX - width
      currentNode.position.x = rightX
      if (currentNode.positionAbsolute)
        currentNode.positionAbsolute.x = rightX
      break
    }
    case AlignType.Top:
      currentNode.position.y = bounds.minY
      if (currentNode.positionAbsolute)
        currentNode.positionAbsolute.y = bounds.minY
      break
    case AlignType.Middle: {
      const middleY = bounds.minY + (bounds.maxY - bounds.minY) / 2 - height / 2
      currentNode.position.y = middleY
      if (currentNode.positionAbsolute)
        currentNode.positionAbsolute.y = middleY
      break
    }
    case AlignType.Bottom: {
      const bottomY = Math.round(bounds.maxY - height)
      currentNode.position.y = bottomY
      if (currentNode.positionAbsolute)
        currentNode.positionAbsolute.y = bottomY
      break
    }
  }
}

const distributeNodes = (
  nodesToAlign: Node[],
  nodes: Node[],
  alignType: AlignTypeValue,
) => {
  const isHorizontal = alignType === AlignType.DistributeHorizontal
  const sortedNodes = [...nodesToAlign].sort((a, b) =>
    isHorizontal ? a.position.x - b.position.x : a.position.y - b.position.y)

  if (sortedNodes.length < 3)
    return null

  const firstNode = sortedNodes[0]
  const lastNode = sortedNodes[sortedNodes.length - 1]

  const totalGap = isHorizontal
    ? lastNode!.position.x + (lastNode!.width || 0) - firstNode!.position.x
    : lastNode!.position.y + (lastNode!.height || 0) - firstNode!.position.y

  const fixedSpace = sortedNodes.reduce((sum, node) =>
    sum + (isHorizontal ? (node.width || 0) : (node.height || 0)), 0)

  const spacing = (totalGap - fixedSpace) / (sortedNodes.length - 1)
  if (spacing <= 0)
    return null

  return produce(nodes, (draft) => {
    let currentPosition = isHorizontal
      ? firstNode!.position.x + (firstNode!.width || 0)
      : firstNode!.position.y + (firstNode!.height || 0)

    for (let index = 1; index < sortedNodes.length - 1; index++) {
      const nodeToAlign = sortedNodes[index]
      const currentNode = draft.find(node => node.id === nodeToAlign!.id)
      if (!currentNode)
        continue

      if (isHorizontal) {
        const nextX = currentPosition + spacing
        currentNode.position.x = nextX
        if (currentNode.positionAbsolute)
          currentNode.positionAbsolute.x = nextX
        currentPosition = nextX + (nodeToAlign!.width || 0)
      }
      else {
        const nextY = currentPosition + spacing
        currentNode.position.y = nextY
        if (currentNode.positionAbsolute)
          currentNode.positionAbsolute.y = nextY
        currentPosition = nextY + (nodeToAlign!.height || 0)
      }
    }
  })
}

const getSelectedSnippetGraph = (
  nodes: Node[],
  edges: Edge[],
  selectedNodes: Node[],
  canvasSize?: {
    width?: number
    height?: number
  },
): SnippetCanvasData => {
  const includedNodeIds = new Set(selectedNodes.map(node => node.id))

  let shouldExpand = true
  while (shouldExpand) {
    shouldExpand = false

    nodes.forEach((node) => {
      if (!includedNodeIds.has(node.id))
        return

      if (node.parentId && !includedNodeIds.has(node.parentId)) {
        includedNodeIds.add(node.parentId)
        shouldExpand = true
      }

      node.data._children?.forEach((child) => {
        if (!includedNodeIds.has(child.nodeId)) {
          includedNodeIds.add(child.nodeId)
          shouldExpand = true
        }
      })
    })
  }

  const rootNodes = nodes.filter(node => includedNodeIds.has(node.id) && (!node.parentId || !includedNodeIds.has(node.parentId)))
  const minRootX = rootNodes.length ? Math.min(...rootNodes.map(node => node.position.x)) : 0
  const minRootY = rootNodes.length ? Math.min(...rootNodes.map(node => node.position.y)) : 0

  const snippetNodes = nodes
    .filter(node => includedNodeIds.has(node.id))
    .map((node) => {
      const isRootNode = !node.parentId || !includedNodeIds.has(node.parentId)
      const nextPosition = isRootNode
        ? { x: node.position.x - minRootX, y: node.position.y - minRootY }
        : node.position

      return {
        ...node,
        position: nextPosition,
        positionAbsolute: node.positionAbsolute
          ? (isRootNode
              ? {
                  x: node.positionAbsolute.x - minRootX,
                  y: node.positionAbsolute.y - minRootY,
                }
              : node.positionAbsolute)
          : undefined,
        selected: false,
        data: {
          ...node.data,
          selected: false,
          _children: node.data._children?.filter(child => includedNodeIds.has(child.nodeId)),
        },
      }
    })
  const snippetEdges = edges
    .filter(edge => includedNodeIds.has(edge.source) && includedNodeIds.has(edge.target))
    .map(edge => ({
      ...edge,
      selected: false,
    }))

  const viewportWidth = canvasSize?.width
  const viewportHeight = canvasSize?.height
  const hasCanvasSize = !!viewportWidth && !!viewportHeight

  const viewport = (() => {
    if (!hasCanvasSize || !snippetNodes.length)
      return DEFAULT_SNIPPET_VIEWPORT

    const bounds = getNodesBounds(snippetNodes)
    const paddedWidth = bounds.width + SNIPPET_VIEWPORT_PADDING
    const paddedHeight = bounds.height + SNIPPET_VIEWPORT_PADDING
    const zoom = Math.min(
      viewportWidth / paddedWidth,
      viewportHeight / paddedHeight,
      1,
    )

    if (!Number.isFinite(zoom) || zoom <= 0)
      return DEFAULT_SNIPPET_VIEWPORT

    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2

    return {
      x: viewportWidth / 2 - centerX * zoom,
      y: viewportHeight / 2 - centerY * zoom,
      zoom,
    }
  })()

  return {
    nodes: snippetNodes,
    edges: snippetEdges,
    viewport,
  }
}

const SelectionContextmenu = () => {
  const { t } = useTranslation()
  const { push } = useRouter()
  const { canAccess: canAccessSnippetsAndEvaluation } = useSnippetAndEvaluationPlanAccess()
  const createSnippetMutation = useCreateSnippetMutation()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleNodesCopy, handleNodesDelete, handleNodesDuplicate } = useNodesInteractions()
  const { handleSelectionContextmenuCancel } = useSelectionInteractions()
  const selectionMenu = useStore(s => s.selectionMenu)
  const [isCreateSnippetDialogOpen, setIsCreateSnippetDialogOpen] = useState(false)
  const [isCreatingSnippet, setIsCreatingSnippet] = useState(false)
  const [selectedGraphSnapshot, setSelectedGraphSnapshot] = useState<SnippetCanvasData | undefined>()

  // Access React Flow methods
  const store = useStoreApi()

  // Access React Flow methods
  const workflowStore = useWorkflowStore()
  const collaborativeWorkflow = useCollaborativeWorkflow()

  // Get selected nodes for alignment logic
  const selectedNodes = useReactFlowStore(state =>
    state.getNodes().filter(node => node.selected),
  )
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { saveStateToHistory } = useWorkflowHistory()

  const anchor = useMemo(() => {
    if (!selectionMenu)
      return undefined

    return {
      getBoundingClientRect: () => DOMRect.fromRect({
        width: 0,
        height: 0,
        x: selectionMenu.clientX,
        y: selectionMenu.clientY,
      }),
    }
  }, [selectionMenu])
  const isMenuOpen = Boolean(selectionMenu && anchor)

  useEffect(() => {
    if (selectionMenu && selectedNodes.length <= 1)
      handleSelectionContextmenuCancel()
  }, [selectionMenu, selectedNodes.length, handleSelectionContextmenuCancel])

  const isAddToSnippetDisabled = useMemo(() => {
    return selectedNodes.some(node =>
      node.data.type === BlockEnum.Start
      || node.data.type === BlockEnum.End
      || node.data.type === BlockEnum.HumanInput
      || TRIGGER_NODE_TYPES.includes(node.data.type as typeof TRIGGER_NODE_TYPES[number]))
  }, [selectedNodes])

  const handleOpenCreateSnippetDialog = useCallback(() => {
    if (!canAccessSnippetsAndEvaluation || isAddToSnippetDisabled)
      return

    const nodes = store.getState().getNodes()
    const { edges } = store.getState()
    const {
      workflowCanvasWidth,
      workflowCanvasHeight,
    } = workflowStore.getState()

    setSelectedGraphSnapshot(getSelectedSnippetGraph(nodes, edges, selectedNodes, {
      width: workflowCanvasWidth,
      height: workflowCanvasHeight,
    }))
    setIsCreateSnippetDialogOpen(true)
    handleSelectionContextmenuCancel()
  }, [canAccessSnippetsAndEvaluation, handleSelectionContextmenuCancel, isAddToSnippetDisabled, selectedNodes, store, workflowStore])

  const handleCloseCreateSnippetDialog = useCallback(() => {
    setIsCreateSnippetDialogOpen(false)
    setSelectedGraphSnapshot(undefined)
  }, [])

  const handleCreateSnippet = useCallback(async ({
    name,
    description,
    icon,
    graph,
  }: CreateSnippetDialogPayload) => {
    setIsCreatingSnippet(true)

    try {
      const snippet = await createSnippetMutation.mutateAsync({
        body: {
          name,
          description: description || undefined,
          icon_info: {
            icon: icon.type === 'emoji' ? icon.icon : icon.fileId,
            icon_type: icon.type,
            icon_background: icon.type === 'emoji' ? icon.background : undefined,
            icon_url: icon.type === 'image' ? icon.url : undefined,
          },
        },
      })

      await consoleClient.snippets.syncDraftWorkflow({
        params: { snippetId: snippet.id },
        body: { graph },
      })

      toast.success(t('snippet.createSuccess', { ns: 'workflow' }))
      handleCloseCreateSnippetDialog()
      push(`/snippets/${snippet.id}/orchestrate`)
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : t('createFailed', { ns: 'snippet' }))
    }
    finally {
      setIsCreatingSnippet(false)
    }
  }, [createSnippetMutation, handleCloseCreateSnippetDialog, push, t])

  const menuActions = useMemo<ActionMenuItem[]>(() => {
    const nextActions: ActionMenuItem[] = []

    if (canAccessSnippetsAndEvaluation) {
      nextActions.push({
        action: 'createSnippet',
        disabled: isAddToSnippetDisabled,
        translationKey: 'snippet.addToSnippet',
      })
    }

    nextActions.push(
      {
        action: 'copy',
        shortcut: 'workflow.copy',
        translationKey: 'common.copy',
      },
      {
        action: 'duplicate',
        shortcut: 'workflow.duplicate',
        translationKey: 'common.duplicate',
      },
      {
        action: 'delete',
        shortcut: 'workflow.delete',
        translationKey: 'operation.delete',
      },
    )

    return nextActions
  }, [canAccessSnippetsAndEvaluation, isAddToSnippetDisabled])

  const getActionLabel = useCallback((translationKey: string) => {
    if (translationKey === 'operation.delete')
      return t(translationKey, { ns: 'common', defaultValue: translationKey })

    return t(translationKey, { ns: 'workflow', defaultValue: translationKey })
  }, [t])

  const handleMenuAction = useCallback((action: ActionMenuItem['action']) => {
    switch (action) {
      case 'createSnippet':
        handleOpenCreateSnippetDialog()
        return
      case 'copy':
        handleSelectionContextmenuCancel()
        handleNodesCopy()
        return
      case 'duplicate':
        handleSelectionContextmenuCancel()
        handleNodesDuplicate()
        return
      case 'delete':
        handleSelectionContextmenuCancel()
        handleNodesDelete()
    }
  }, [handleNodesCopy, handleNodesDelete, handleNodesDuplicate, handleOpenCreateSnippetDialog, handleSelectionContextmenuCancel])

  const handleAlignNodes = useCallback((alignType: AlignTypeValue) => {
    if (getNodesReadOnly() || selectedNodes.length <= 1) {
      handleSelectionContextmenuCancel()
      return
    }

    workflowStore.setState({ nodeAnimation: false })

    // Get all current nodes
    const { nodes, setNodes } = collaborativeWorkflow.getState()

    // Get all selected nodes
    const selectedNodeIds = selectedNodes.map(node => node.id)

    // Find container nodes and their children
    // Container nodes (like Iteration and Loop) have child nodes that should not be aligned independently
    // when the container is selected. This prevents child nodes from being moved outside their containers.
    const childNodeIds = new Set<string>()

    nodes.forEach((node) => {
      // Check if this is a container node (Iteration or Loop)
      if (node.data._children && node.data._children.length > 0) {
        // If container node is selected, add its children to the exclusion set
        if (selectedNodeIds.includes(node.id)) {
          // Add all its children to the childNodeIds set
          node.data._children.forEach((child: { nodeId: string, nodeType: string }) => {
            childNodeIds.add(child.nodeId)
          })
        }
      }
    })

    // Filter out child nodes from the alignment operation
    // Only align nodes that are selected AND are not children of container nodes
    // This ensures container nodes can be aligned while their children stay in the same relative position
    const nodesToAlign = getAlignableNodes(nodes, selectedNodes)

    if (nodesToAlign.length <= 1) {
      handleSelectionContextmenuCancel()
      return
    }

    const bounds = getAlignBounds(nodesToAlign)
    if (!bounds) {
      handleSelectionContextmenuCancel()
      return
    }

    if (alignType === AlignType.DistributeHorizontal || alignType === AlignType.DistributeVertical) {
      const distributedNodes = distributeNodes(nodesToAlign, nodes, alignType)
      if (distributedNodes) {
        setNodes(distributedNodes)
        handleSelectionContextmenuCancel()

        const { setHelpLineHorizontal, setHelpLineVertical } = workflowStore.getState()
        setHelpLineHorizontal()
        setHelpLineVertical()

        handleSyncWorkflowDraft()
        saveStateToHistory(WorkflowHistoryEvent.NodeDragStop)
        return
      }
    }

    const newNodes = produce(nodes, (draft) => {
      const validNodesToAlign = nodesToAlign.filter(node => node.width && node.height)
      validNodesToAlign.forEach((nodeToAlign) => {
        const currentNode = draft.find(n => n.id === nodeToAlign.id)
        if (!currentNode)
          return

        alignNodePosition(currentNode, nodeToAlign, alignType, bounds)
      })
    })

    try {
      // Directly use setNodes to update nodes - consistent with handleNodeDrag
      setNodes(newNodes)

      // Close popup
      handleSelectionContextmenuCancel()
      const { setHelpLineHorizontal, setHelpLineVertical } = workflowStore.getState()
      setHelpLineHorizontal()
      setHelpLineVertical()
      handleSyncWorkflowDraft()
      saveStateToHistory(WorkflowHistoryEvent.NodeDragStop)
    }
    catch (err) {
      console.error('Failed to update nodes:', err)
    }
  }, [collaborativeWorkflow, workflowStore, selectedNodes, getNodesReadOnly, handleSyncWorkflowDraft, saveStateToHistory, handleSelectionContextmenuCancel])

  if ((!selectionMenu || !anchor) && !isCreateSnippetDialogOpen)
    return null

  return (
    <div data-testid="selection-contextmenu">
      <ContextMenu
        open={isMenuOpen}
        onOpenChange={(open) => {
          if (!open)
            handleSelectionContextmenuCancel()
        }}
      >
        {isMenuOpen && (
          <ContextMenuContent
            positionerProps={{ anchor }}
            popupClassName="w-[240px] py-0"
          >
            <div className="p-1">
              {menuActions.map(item => (
                <ContextMenuItem
                  key={item.action}
                  data-testid={`selection-contextmenu-item-${item.action}`}
                  disabled={item.disabled}
                  className={cn(
                    'mx-0 h-8 justify-between gap-3 rounded-lg px-2 text-[14px] leading-5 font-normal text-text-secondary',
                    item.action === 'delete' && 'data-highlighted:bg-state-destructive-hover data-highlighted:text-text-destructive',
                  )}
                  onClick={() => handleMenuAction(item.action)}
                >
                  <span>{getActionLabel(item.translationKey)}</span>
                  {item.shortcut && (
                    <ShortcutKbd
                      shortcut={item.shortcut}
                      textColor="secondary"
                    />
                  )}
                </ContextMenuItem>
              ))}
            </div>
            <ContextMenuSeparator className="my-0" />
            <div className="p-1.5">
              <div className="flex items-center">
                {alignMenuItems.map((item) => {
                  return (
                    <ContextMenuItem
                      key={item.alignType}
                      aria-label={t(item.translationKey, { defaultValue: item.translationKey, ns: 'workflow' })}
                      className="mx-0 h-8 w-8 justify-center rounded-md px-0 text-text-tertiary data-highlighted:bg-state-base-hover data-highlighted:text-text-secondary"
                      data-testid={`selection-contextmenu-item-${item.alignType}`}
                      onClick={() => handleAlignNodes(item.alignType)}
                    >
                      <span aria-hidden className={`${item.icon} h-4 w-4 ${item.iconClassName ?? ''}`.trim()} />
                    </ContextMenuItem>
                  )
                })}
              </div>
            </div>
          </ContextMenuContent>
        )}
      </ContextMenu>
      {isCreateSnippetDialogOpen && (
        <CreateSnippetDialog
          isOpen={isCreateSnippetDialogOpen}
          selectedGraph={selectedGraphSnapshot}
          isSubmitting={isCreatingSnippet || createSnippetMutation.isPending}
          onClose={handleCloseCreateSnippetDialog}
          onConfirm={handleCreateSnippet}
        />
      )}
    </div>
  )
}

export default memo(SelectionContextmenu)
