import type { Node } from './types'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '@langgenius/dify-ui/context-menu'
import { produce } from 'immer'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useReactFlowStore } from 'reactflow'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import { useNodesInteractions, useNodesReadOnly, useNodesSyncDraft } from './hooks'
import { useSelectionInteractions } from './hooks/use-selection-interactions'
import { useWorkflowHistory, WorkflowHistoryEvent } from './hooks/use-workflow-history'
import { ShortcutKbd } from './shortcuts/shortcut-kbd'
import { useStore, useWorkflowStore } from './store'

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

type MenuItem = {
  alignType: AlignTypeValue
  icon: string
  iconClassName?: string
  translationKey: string
}

type MenuSection = {
  titleKey: string
  items: MenuItem[]
}

const menuSections: MenuSection[] = [
  {
    titleKey: 'operator.vertical',
    items: [
      { alignType: AlignType.Top, icon: 'i-ri-align-top', translationKey: 'operator.alignTop' },
      { alignType: AlignType.Middle, icon: 'i-ri-align-center', iconClassName: 'rotate-90', translationKey: 'operator.alignMiddle' },
      { alignType: AlignType.Bottom, icon: 'i-ri-align-bottom', translationKey: 'operator.alignBottom' },
      { alignType: AlignType.DistributeVertical, icon: 'i-ri-align-justify', iconClassName: 'rotate-90', translationKey: 'operator.distributeVertical' },
    ],
  },
  {
    titleKey: 'operator.horizontal',
    items: [
      { alignType: AlignType.Left, icon: 'i-ri-align-left', translationKey: 'operator.alignLeft' },
      { alignType: AlignType.Center, icon: 'i-ri-align-center', translationKey: 'operator.alignCenter' },
      { alignType: AlignType.Right, icon: 'i-ri-align-right', translationKey: 'operator.alignRight' },
      { alignType: AlignType.DistributeHorizontal, icon: 'i-ri-align-justify', translationKey: 'operator.distributeHorizontal' },
    ],
  },
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

const SelectionContextmenu = () => {
  const { t } = useTranslation()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleSelectionContextmenuCancel } = useSelectionInteractions()
  const { handleNodesCopy, handleNodesDelete, handleNodesDuplicate } = useNodesInteractions()
  const selectionMenu = useStore(s => s.selectionMenu)

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

  useEffect(() => {
    if (selectionMenu && selectedNodes.length <= 1)
      handleSelectionContextmenuCancel()
  }, [selectionMenu, selectedNodes.length, handleSelectionContextmenuCancel])

  const handleCopyNodes = useCallback(() => {
    handleNodesCopy()
    handleSelectionContextmenuCancel()
  }, [handleNodesCopy, handleSelectionContextmenuCancel])

  const handleDuplicateNodes = useCallback(() => {
    handleNodesDuplicate()
    handleSelectionContextmenuCancel()
  }, [handleNodesDuplicate, handleSelectionContextmenuCancel])

  const handleDeleteNodes = useCallback(() => {
    handleNodesDelete()
    handleSelectionContextmenuCancel()
  }, [handleNodesDelete, handleSelectionContextmenuCancel])

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

  if (!selectionMenu)
    return null

  return (
    <ContextMenu
      open
      onOpenChange={(open) => {
        if (!open)
          handleSelectionContextmenuCancel()
      }}
    >
      <ContextMenuContent
        popupClassName="w-[240px]"
        positionerProps={anchor ? { anchor } : undefined}
      >
        <ContextMenuGroup>
          <ContextMenuItem
            className="justify-between px-3 text-text-secondary"
            onClick={handleCopyNodes}
          >
            <span>{t('common.copy', { defaultValue: 'common.copy', ns: 'workflow' })}</span>
            <ShortcutKbd shortcut="workflow.copy" />
          </ContextMenuItem>
          <ContextMenuItem
            className="justify-between px-3 text-text-secondary"
            onClick={handleDuplicateNodes}
          >
            <span>{t('common.duplicate', { defaultValue: 'common.duplicate', ns: 'workflow' })}</span>
            <ShortcutKbd shortcut="workflow.duplicate" />
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem
            className="justify-between px-3 text-text-secondary data-highlighted:bg-state-destructive-hover data-highlighted:text-text-destructive"
            onClick={handleDeleteNodes}
          >
            <span>{t('operation.delete', { defaultValue: 'operation.delete', ns: 'common' })}</span>
            <ShortcutKbd shortcut="workflow.delete" />
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        {menuSections.map((section, sectionIndex) => (
          <ContextMenuGroup key={section.titleKey}>
            {sectionIndex > 0 && <ContextMenuSeparator />}
            <ContextMenuLabel>
              {t(section.titleKey, { defaultValue: section.titleKey, ns: 'workflow' })}
            </ContextMenuLabel>
            {section.items.map((item) => {
              return (
                <ContextMenuItem
                  key={item.alignType}
                  data-testid={`selection-contextmenu-item-${item.alignType}`}
                  onClick={() => handleAlignNodes(item.alignType)}
                >
                  <span aria-hidden className={`${item.icon} h-4 w-4 ${item.iconClassName ?? ''}`.trim()} />
                  {t(item.translationKey, { defaultValue: item.translationKey, ns: 'workflow' })}
                </ContextMenuItem>
              )
            })}
          </ContextMenuGroup>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export default memo(SelectionContextmenu)
