import type { ComponentType } from 'react'
import type { Node } from './types'
import {
  RiAlignItemBottomLine,
  RiAlignItemHorizontalCenterLine,
  RiAlignItemLeftLine,
  RiAlignItemRightLine,
  RiAlignItemTopLine,
  RiAlignItemVerticalCenterLine,
  RiAlignJustify,
} from '@remixicon/react'
import { produce } from 'immer'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useReactFlowStore, useStoreApi } from 'reactflow'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/app/components/base/ui/context-menu'
import { cn } from '@/utils/classnames'
import CreateSnippetDialog from './create-snippet-dialog'
import { useNodesInteractions, useNodesReadOnly, useNodesSyncDraft } from './hooks'
import { useSelectionInteractions } from './hooks/use-selection-interactions'
import { useWorkflowHistory, WorkflowHistoryEvent } from './hooks/use-workflow-history'
import ShortcutsName from './shortcuts-name'
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

type SelectionMenuPosition = {
  left: number
  top: number
}

type ContainerRect = Pick<DOMRect, 'width' | 'height'>

type AlignBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type AlignMenuItem = {
  alignType: AlignTypeValue
  icon: ComponentType<{ className?: string }>
  iconClassName?: string
  translationKey: string
}

type ActionMenuItem = {
  action: 'copy' | 'createSnippet' | 'delete' | 'duplicate'
  disabled?: boolean
  shortcutKeys?: string[]
  translationKey: string
}

const MENU_WIDTH = 240
const MENU_HEIGHT = 240

const alignMenuItems: AlignMenuItem[] = [
  { alignType: AlignType.Left, icon: RiAlignItemLeftLine, translationKey: 'operator.alignLeft' },
  { alignType: AlignType.Center, icon: RiAlignItemHorizontalCenterLine, translationKey: 'operator.alignCenter' },
  { alignType: AlignType.Right, icon: RiAlignItemRightLine, translationKey: 'operator.alignRight' },
  { alignType: AlignType.Top, icon: RiAlignItemTopLine, translationKey: 'operator.alignTop' },
  { alignType: AlignType.Middle, icon: RiAlignItemVerticalCenterLine, iconClassName: 'rotate-90', translationKey: 'operator.alignMiddle' },
  { alignType: AlignType.Bottom, icon: RiAlignItemBottomLine, translationKey: 'operator.alignBottom' },
  { alignType: AlignType.DistributeHorizontal, icon: RiAlignJustify, translationKey: 'operator.distributeHorizontal' },
  { alignType: AlignType.DistributeVertical, icon: RiAlignJustify, iconClassName: 'rotate-90', translationKey: 'operator.distributeVertical' },
]

const getMenuPosition = (
  selectionMenu: SelectionMenuPosition | undefined,
  containerRect?: ContainerRect | null,
) => {
  if (!selectionMenu)
    return { left: 0, top: 0 }

  let { left, top } = selectionMenu

  if (containerRect) {
    if (left + MENU_WIDTH > containerRect.width)
      left = left - MENU_WIDTH

    if (top + MENU_HEIGHT > containerRect.height)
      top = top - MENU_HEIGHT

    left = Math.max(0, left)
    top = Math.max(0, top)
  }

  return { left, top }
}

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
    ? lastNode.position.x + (lastNode.width || 0) - firstNode.position.x
    : lastNode.position.y + (lastNode.height || 0) - firstNode.position.y

  const fixedSpace = sortedNodes.reduce((sum, node) =>
    sum + (isHorizontal ? (node.width || 0) : (node.height || 0)), 0)

  const spacing = (totalGap - fixedSpace) / (sortedNodes.length - 1)
  if (spacing <= 0)
    return null

  return produce(nodes, (draft) => {
    let currentPosition = isHorizontal
      ? firstNode.position.x + (firstNode.width || 0)
      : firstNode.position.y + (firstNode.height || 0)

    for (let index = 1; index < sortedNodes.length - 1; index++) {
      const nodeToAlign = sortedNodes[index]
      const currentNode = draft.find(node => node.id === nodeToAlign.id)
      if (!currentNode)
        continue

      if (isHorizontal) {
        const nextX = currentPosition + spacing
        currentNode.position.x = nextX
        if (currentNode.positionAbsolute)
          currentNode.positionAbsolute.x = nextX
        currentPosition = nextX + (nodeToAlign.width || 0)
      }
      else {
        const nextY = currentPosition + spacing
        currentNode.position.y = nextY
        if (currentNode.positionAbsolute)
          currentNode.positionAbsolute.y = nextY
        currentPosition = nextY + (nodeToAlign.height || 0)
      }
    }
  })
}

const SelectionContextmenu = () => {
  const { t } = useTranslation()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleNodesCopy, handleNodesDelete, handleNodesDuplicate } = useNodesInteractions()
  const { handleSelectionContextmenuCancel } = useSelectionInteractions()
  const selectionMenu = useStore(s => s.selectionMenu)
  const [isCreateSnippetDialogOpen, setIsCreateSnippetDialogOpen] = useState(false)
  const [selectedNodeIdsSnapshot, setSelectedNodeIdsSnapshot] = useState<string[]>([])

  // Access React Flow methods
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const selectedNodes = useReactFlowStore(state =>
    state.getNodes().filter(node => node.selected),
  )
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { saveStateToHistory } = useWorkflowHistory()

  const menuPosition = useMemo(() => {
    const container = document.querySelector('#workflow-container')
    return getMenuPosition(selectionMenu, container?.getBoundingClientRect())
  }, [selectionMenu])

  const anchor = useMemo(() => {
    if (!selectionMenu)
      return null

    const container = document.querySelector('#workflow-container')
    const containerRect = container?.getBoundingClientRect()
    if (!containerRect)
      return null

    return {
      getBoundingClientRect: () => DOMRect.fromRect({
        width: 0,
        height: 0,
        x: containerRect.left + menuPosition.left,
        y: containerRect.top + menuPosition.top,
      }),
    }
  }, [menuPosition.left, menuPosition.top, selectionMenu])

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
    if (isAddToSnippetDisabled)
      return

    setSelectedNodeIdsSnapshot(selectedNodes.map(node => node.id))
    setIsCreateSnippetDialogOpen(true)
    handleSelectionContextmenuCancel()
  }, [handleSelectionContextmenuCancel, isAddToSnippetDisabled, selectedNodes])

  const handleCloseCreateSnippetDialog = useCallback(() => {
    setIsCreateSnippetDialogOpen(false)
    setSelectedNodeIdsSnapshot([])
  }, [])

  const menuActions = useMemo<ActionMenuItem[]>(() => [
    {
      action: 'createSnippet',
      disabled: isAddToSnippetDisabled,
      translationKey: 'snippet.addToSnippet',
    },
    {
      action: 'copy',
      shortcutKeys: ['ctrl', 'c'],
      translationKey: 'common.copy',
    },
    {
      action: 'duplicate',
      shortcutKeys: ['ctrl', 'd'],
      translationKey: 'common.duplicate',
    },
    {
      action: 'delete',
      shortcutKeys: ['del'],
      translationKey: 'operation.delete',
    },
  ], [isAddToSnippetDisabled])

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

    const nodes = store.getState().getNodes()
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
        store.getState().setNodes(distributedNodes)
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
      store.getState().setNodes(newNodes)
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
  }, [store, workflowStore, selectedNodes, getNodesReadOnly, handleSyncWorkflowDraft, saveStateToHistory, handleSelectionContextmenuCancel])

  if ((!selectionMenu || !anchor) && !isCreateSnippetDialogOpen)
    return null

  return (
    <div data-testid="selection-contextmenu">
      <ContextMenu
        open
        onOpenChange={(open) => {
          if (!open)
            handleSelectionContextmenuCancel()
        }}
      >
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
                  'mx-0 h-8 justify-between gap-3 rounded-lg px-2 text-[14px] font-normal leading-5 text-text-secondary',
                  item.action === 'delete' && 'data-[highlighted]:bg-state-destructive-hover data-[highlighted]:text-text-destructive',
                )}
                onClick={() => handleMenuAction(item.action)}
              >
                <span>{getActionLabel(item.translationKey)}</span>
                {item.shortcutKeys && (
                  <ShortcutsName
                    keys={item.shortcutKeys}
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
                const Icon = item.icon
                return (
                  <ContextMenuItem
                    key={item.alignType}
                    aria-label={t(item.translationKey, { defaultValue: item.translationKey, ns: 'workflow' })}
                    className="mx-0 h-8 w-8 justify-center rounded-md px-0 text-text-tertiary data-[highlighted]:bg-state-base-hover data-[highlighted]:text-text-secondary"
                    data-testid={`selection-contextmenu-item-${item.alignType}`}
                    onClick={() => handleAlignNodes(item.alignType)}
                  >
                    <Icon className={`h-[18px] w-[18px] ${item.iconClassName ?? ''}`.trim()} />
                  </ContextMenuItem>
                )
              })}
            </div>
          </div>
        </ContextMenuContent>
      </ContextMenu>
      {isCreateSnippetDialogOpen && (
        <CreateSnippetDialog
          isOpen={isCreateSnippetDialogOpen}
          selectedNodeIds={selectedNodeIdsSnapshot}
          onClose={handleCloseCreateSnippetDialog}
          onConfirm={(payload) => {
            void payload
          }}
        />
      )}
    </div>
  )
}

export default memo(SelectionContextmenu)
