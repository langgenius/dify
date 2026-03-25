import type { ComponentType } from 'react'
import type { Node } from './types'
import {
  RiAlignBottom,
  RiAlignCenter,
  RiAlignJustify,
  RiAlignLeft,
  RiAlignRight,
  RiAlignTop,
} from '@remixicon/react'
import { produce } from 'immer'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useReactFlowStore, useStoreApi } from 'reactflow'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuGroupLabel,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/app/components/base/ui/context-menu'
import { useNodesReadOnly, useNodesSyncDraft } from './hooks'
import { useSelectionInteractions } from './hooks/use-selection-interactions'
import { useWorkflowHistory, WorkflowHistoryEvent } from './hooks/use-workflow-history'
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

type MenuItem = {
  alignType: AlignTypeValue
  icon: ComponentType<{ className?: string }>
  iconClassName?: string
  translationKey: string
}

type MenuSection = {
  titleKey: string
  items: MenuItem[]
}

const MENU_WIDTH = 240
const MENU_HEIGHT = 380

const menuSections: MenuSection[] = [
  {
    titleKey: 'operator.vertical',
    items: [
      { alignType: AlignType.Top, icon: RiAlignTop, translationKey: 'operator.alignTop' },
      { alignType: AlignType.Middle, icon: RiAlignCenter, iconClassName: 'rotate-90', translationKey: 'operator.alignMiddle' },
      { alignType: AlignType.Bottom, icon: RiAlignBottom, translationKey: 'operator.alignBottom' },
      { alignType: AlignType.DistributeVertical, icon: RiAlignJustify, iconClassName: 'rotate-90', translationKey: 'operator.distributeVertical' },
    ],
  },
  {
    titleKey: 'operator.horizontal',
    items: [
      { alignType: AlignType.Left, icon: RiAlignLeft, translationKey: 'operator.alignLeft' },
      { alignType: AlignType.Center, icon: RiAlignCenter, translationKey: 'operator.alignCenter' },
      { alignType: AlignType.Right, icon: RiAlignRight, translationKey: 'operator.alignRight' },
      { alignType: AlignType.DistributeHorizontal, icon: RiAlignJustify, translationKey: 'operator.distributeHorizontal' },
    ],
  },
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
  const { handleSelectionContextmenuCancel } = useSelectionInteractions()
  const selectionMenu = useStore(s => s.selectionMenu)
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

  useEffect(() => {
    if (selectionMenu && selectedNodes.length <= 1)
      handleSelectionContextmenuCancel()
  }, [selectionMenu, selectedNodes.length, handleSelectionContextmenuCancel])

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

  if (!selectionMenu)
    return null

  return (
    <div
      className="absolute z-[9]"
      data-testid="selection-contextmenu"
      style={{
        left: menuPosition.left,
        top: menuPosition.top,
      }}
    >
      <ContextMenu
        open
        onOpenChange={(open) => {
          if (!open)
            handleSelectionContextmenuCancel()
        }}
      >
        <ContextMenuTrigger>
          <span aria-hidden className="block size-px opacity-0" />
        </ContextMenuTrigger>
        <ContextMenuContent popupClassName="w-[240px]">
          {menuSections.map((section, sectionIndex) => (
            <ContextMenuGroup key={section.titleKey}>
              {sectionIndex > 0 && <ContextMenuSeparator />}
              <ContextMenuGroupLabel>
                {t(section.titleKey, { defaultValue: section.titleKey, ns: 'workflow' })}
              </ContextMenuGroupLabel>
              {section.items.map((item) => {
                const Icon = item.icon
                return (
                  <ContextMenuItem
                    key={item.alignType}
                    data-testid={`selection-contextmenu-item-${item.alignType}`}
                    onClick={() => handleAlignNodes(item.alignType)}
                  >
                    <Icon className={`h-4 w-4 ${item.iconClassName ?? ''}`.trim()} />
                    {t(item.translationKey, { defaultValue: item.translationKey, ns: 'workflow' })}
                  </ContextMenuItem>
                )
              })}
            </ContextMenuGroup>
          ))}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}

export default memo(SelectionContextmenu)
