import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useClickAway } from 'ahooks'
import { useStore as useReactFlowStore, useStoreApi } from 'reactflow'
import {
  RiAlignBottom,
  RiAlignCenter,
  RiAlignJustify,
  RiAlignLeft,
  RiAlignRight,
  RiAlignTop,
} from '@remixicon/react'
import { useNodesReadOnly, useNodesSyncDraft } from './hooks'
import { produce } from 'immer'
import { WorkflowHistoryEvent, useWorkflowHistory } from './hooks/use-workflow-history'
import { useStore } from './store'
import { useSelectionInteractions } from './hooks/use-selection-interactions'
import { useWorkflowStore } from './store'

enum AlignType {
  Left = 'left',
  Center = 'center',
  Right = 'right',
  Top = 'top',
  Middle = 'middle',
  Bottom = 'bottom',
  DistributeHorizontal = 'distributeHorizontal',
  DistributeVertical = 'distributeVertical',
}

const SelectionContextmenu = () => {
  const { t } = useTranslation()
  const ref = useRef(null)
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleSelectionContextmenuCancel } = useSelectionInteractions()
  const selectionMenu = useStore(s => s.selectionMenu)

  // Access React Flow methods
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  // Get selected nodes for alignment logic
  const selectedNodes = useReactFlowStore(state =>
    state.getNodes().filter(node => node.selected),
  )

  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { saveStateToHistory } = useWorkflowHistory()

  const menuRef = useRef<HTMLDivElement>(null)

  const menuPosition = useMemo(() => {
    if (!selectionMenu) return { left: 0, top: 0 }

    let left = selectionMenu.left
    let top = selectionMenu.top

    const container = document.querySelector('#workflow-container')
    if (container) {
      const { width: containerWidth, height: containerHeight } = container.getBoundingClientRect()

      const menuWidth = 240

      const estimatedMenuHeight = 380

      if (left + menuWidth > containerWidth)
        left = left - menuWidth

      if (top + estimatedMenuHeight > containerHeight)
        top = top - estimatedMenuHeight

      left = Math.max(0, left)
      top = Math.max(0, top)
    }

    return { left, top }
  }, [selectionMenu])

  useClickAway(() => {
    handleSelectionContextmenuCancel()
  }, ref)

  useEffect(() => {
    if (selectionMenu && selectedNodes.length <= 1)
      handleSelectionContextmenuCancel()
  }, [selectionMenu, selectedNodes.length, handleSelectionContextmenuCancel])

  // Handle align nodes logic
  const handleAlignNode = useCallback((currentNode: any, nodeToAlign: any, alignType: AlignType, minX: number, maxX: number, minY: number, maxY: number) => {
    const width = nodeToAlign.width
    const height = nodeToAlign.height

    // Calculate new positions based on alignment type
    switch (alignType) {
      case AlignType.Left:
        // For left alignment, align left edge of each node to minX
        currentNode.position.x = minX
        if (currentNode.positionAbsolute)
          currentNode.positionAbsolute.x = minX
        break

      case AlignType.Center: {
        // For center alignment, center each node horizontally in the selection bounds
        const centerX = minX + (maxX - minX) / 2 - width / 2
        currentNode.position.x = centerX
        if (currentNode.positionAbsolute)
          currentNode.positionAbsolute.x = centerX
        break
      }

      case AlignType.Right: {
        // For right alignment, align right edge of each node to maxX
        const rightX = maxX - width
        currentNode.position.x = rightX
        if (currentNode.positionAbsolute)
          currentNode.positionAbsolute.x = rightX
        break
      }

      case AlignType.Top: {
        // For top alignment, align top edge of each node to minY
        currentNode.position.y = minY
        if (currentNode.positionAbsolute)
          currentNode.positionAbsolute.y = minY
        break
      }

      case AlignType.Middle: {
        // For middle alignment, center each node vertically in the selection bounds
        const middleY = minY + (maxY - minY) / 2 - height / 2
        currentNode.position.y = middleY
        if (currentNode.positionAbsolute)
          currentNode.positionAbsolute.y = middleY
        break
      }

      case AlignType.Bottom: {
        // For bottom alignment, align bottom edge of each node to maxY
        const newY = Math.round(maxY - height)
        currentNode.position.y = newY
        if (currentNode.positionAbsolute)
          currentNode.positionAbsolute.y = newY
        break
      }
    }
  }, [])

  // Handle distribute nodes logic
  const handleDistributeNodes = useCallback((nodesToAlign: any[], nodes: any[], alignType: AlignType) => {
    // Sort nodes appropriately
    const sortedNodes = [...nodesToAlign].sort((a, b) => {
      if (alignType === AlignType.DistributeHorizontal) {
        // Sort by left position for horizontal distribution
        return a.position.x - b.position.x
      }
      else {
        // Sort by top position for vertical distribution
        return a.position.y - b.position.y
      }
    })

    if (sortedNodes.length < 3)
      return null // Need at least 3 nodes for distribution

    let totalGap = 0
    let fixedSpace = 0

    if (alignType === AlignType.DistributeHorizontal) {
      // Fixed positions - first node's left edge and last node's right edge
      const firstNodeLeft = sortedNodes[0].position.x
      const lastNodeRight = sortedNodes[sortedNodes.length - 1].position.x + (sortedNodes[sortedNodes.length - 1].width || 0)

      // Total available space
      totalGap = lastNodeRight - firstNodeLeft

      // Space occupied by nodes themselves
      fixedSpace = sortedNodes.reduce((sum, node) => sum + (node.width || 0), 0)
    }
    else {
      // Fixed positions - first node's top edge and last node's bottom edge
      const firstNodeTop = sortedNodes[0].position.y
      const lastNodeBottom = sortedNodes[sortedNodes.length - 1].position.y + (sortedNodes[sortedNodes.length - 1].height || 0)

      // Total available space
      totalGap = lastNodeBottom - firstNodeTop

      // Space occupied by nodes themselves
      fixedSpace = sortedNodes.reduce((sum, node) => sum + (node.height || 0), 0)
    }

    // Available space for gaps
    const availableSpace = totalGap - fixedSpace

    // Calculate even spacing between node edges
    const spacing = availableSpace / (sortedNodes.length - 1)

    if (spacing <= 0)
      return null // Nodes are overlapping, can't distribute evenly

    return produce(nodes, (draft) => {
      // Keep first node fixed, position others with even gaps
      let currentPosition

      if (alignType === AlignType.DistributeHorizontal) {
        // Start from first node's right edge
        currentPosition = sortedNodes[0].position.x + (sortedNodes[0].width || 0)
      }
      else {
        // Start from first node's bottom edge
        currentPosition = sortedNodes[0].position.y + (sortedNodes[0].height || 0)
      }

      // Skip first node (index 0), it stays in place
      for (let i = 1; i < sortedNodes.length - 1; i++) {
        const nodeToAlign = sortedNodes[i]
        const currentNode = draft.find(n => n.id === nodeToAlign.id)
        if (!currentNode) continue

        if (alignType === AlignType.DistributeHorizontal) {
          // Position = previous right edge + spacing
          const newX: number = currentPosition + spacing
          currentNode.position.x = newX
          if (currentNode.positionAbsolute)
            currentNode.positionAbsolute.x = newX

          // Update for next iteration - current node's right edge
          currentPosition = newX + (nodeToAlign.width || 0)
        }
        else {
          // Position = previous bottom edge + spacing
          const newY: number = currentPosition + spacing
          currentNode.position.y = newY
          if (currentNode.positionAbsolute)
            currentNode.positionAbsolute.y = newY

          // Update for next iteration - current node's bottom edge
          currentPosition = newY + (nodeToAlign.height || 0)
        }
      }
    })
  }, [])

  const handleAlignNodes = useCallback((alignType: AlignType) => {
    if (getNodesReadOnly() || selectedNodes.length <= 1) {
      handleSelectionContextmenuCancel()
      return
    }

    // Disable node animation state - same as handleNodeDragStart
    workflowStore.setState({ nodeAnimation: false })

    // Get all current nodes
    const nodes = store.getState().getNodes()

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
          node.data._children.forEach((child: { nodeId: string; nodeType: string }) => {
            childNodeIds.add(child.nodeId)
          })
        }
      }
    })

    // Filter out child nodes from the alignment operation
    // Only align nodes that are selected AND are not children of container nodes
    // This ensures container nodes can be aligned while their children stay in the same relative position
    const nodesToAlign = nodes.filter(node =>
      selectedNodeIds.includes(node.id) && !childNodeIds.has(node.id))

    if (nodesToAlign.length <= 1) {
      handleSelectionContextmenuCancel()
      return
    }

    // Calculate node boundaries for alignment
    let minX = Number.MAX_SAFE_INTEGER
    let maxX = Number.MIN_SAFE_INTEGER
    let minY = Number.MAX_SAFE_INTEGER
    let maxY = Number.MIN_SAFE_INTEGER

    // Calculate boundaries of selected nodes
    const validNodes = nodesToAlign.filter(node => node.width && node.height)
    validNodes.forEach((node) => {
      const width = node.width!
      const height = node.height!
      minX = Math.min(minX, node.position.x)
      maxX = Math.max(maxX, node.position.x + width)
      minY = Math.min(minY, node.position.y)
      maxY = Math.max(maxY, node.position.y + height)
    })

    // Handle distribute nodes logic
    if (alignType === AlignType.DistributeHorizontal || alignType === AlignType.DistributeVertical) {
      const distributeNodes = handleDistributeNodes(nodesToAlign, nodes, alignType)
      if (distributeNodes) {
        // Apply node distribution updates
        store.getState().setNodes(distributeNodes)
        handleSelectionContextmenuCancel()

        // Clear guide lines
        const { setHelpLineHorizontal, setHelpLineVertical } = workflowStore.getState()
        setHelpLineHorizontal()
        setHelpLineVertical()

        // Sync workflow draft
        handleSyncWorkflowDraft()

        // Save to history
        saveStateToHistory(WorkflowHistoryEvent.NodeDragStop)

        return // End function execution
      }
    }

    const newNodes = produce(nodes, (draft) => {
      // Iterate through all selected nodes
      const validNodesToAlign = nodesToAlign.filter(node => node.width && node.height)
      validNodesToAlign.forEach((nodeToAlign) => {
        // Find the corresponding node in draft - consistent with handleNodeDrag
        const currentNode = draft.find(n => n.id === nodeToAlign.id)
        if (!currentNode)
          return

        // Use the extracted alignment function
        handleAlignNode(currentNode, nodeToAlign, alignType, minX, maxX, minY, maxY)
      })
    })

    // Apply node position updates - consistent with handleNodeDrag and handleNodeDragStop
    try {
      // Directly use setNodes to update nodes - consistent with handleNodeDrag
      store.getState().setNodes(newNodes)

      // Close popup
      handleSelectionContextmenuCancel()

      // Clear guide lines - consistent with handleNodeDragStop
      const { setHelpLineHorizontal, setHelpLineVertical } = workflowStore.getState()
      setHelpLineHorizontal()
      setHelpLineVertical()

      // Sync workflow draft - consistent with handleNodeDragStop
      handleSyncWorkflowDraft()

      // Save to history - consistent with handleNodeDragStop
      saveStateToHistory(WorkflowHistoryEvent.NodeDragStop)
    }
    catch (err) {
      console.error('Failed to update nodes:', err)
    }
  }, [store, workflowStore, selectedNodes, getNodesReadOnly, handleSyncWorkflowDraft, saveStateToHistory, handleSelectionContextmenuCancel, handleAlignNode, handleDistributeNodes])

  if (!selectionMenu)
    return null

  return (
    <div
      className='absolute z-[9]'
      style={{
        left: menuPosition.left,
        top: menuPosition.top,
      }}
      ref={ref}
    >
      <div ref={menuRef} className='w-[240px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl'>
        <div className='p-1'>
          <div className='system-xs-medium px-2 py-2 text-text-tertiary'>
            {t('workflow.operator.vertical')}
          </div>
          <div
            className='flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'
            onClick={() => handleAlignNodes(AlignType.Top)}
          >
            <RiAlignTop className='h-4 w-4' />
            {t('workflow.operator.alignTop')}
          </div>
          <div
            className='flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'
            onClick={() => handleAlignNodes(AlignType.Middle)}
          >
            <RiAlignCenter className='h-4 w-4 rotate-90' />
            {t('workflow.operator.alignMiddle')}
          </div>
          <div
            className='flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'
            onClick={() => handleAlignNodes(AlignType.Bottom)}
          >
            <RiAlignBottom className='h-4 w-4' />
            {t('workflow.operator.alignBottom')}
          </div>
          <div
            className='flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'
            onClick={() => handleAlignNodes(AlignType.DistributeVertical)}
          >
            <RiAlignJustify className='h-4 w-4 rotate-90' />
            {t('workflow.operator.distributeVertical')}
          </div>
        </div>
        <div className='h-px bg-divider-regular'></div>
        <div className='p-1'>
          <div className='system-xs-medium px-2 py-2 text-text-tertiary'>
            {t('workflow.operator.horizontal')}
          </div>
          <div
            className='flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'
            onClick={() => handleAlignNodes(AlignType.Left)}
          >
            <RiAlignLeft className='h-4 w-4' />
            {t('workflow.operator.alignLeft')}
          </div>
          <div
            className='flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'
            onClick={() => handleAlignNodes(AlignType.Center)}
          >
            <RiAlignCenter className='h-4 w-4' />
            {t('workflow.operator.alignCenter')}
          </div>
          <div
            className='flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'
            onClick={() => handleAlignNodes(AlignType.Right)}
          >
            <RiAlignRight className='h-4 w-4' />
            {t('workflow.operator.alignRight')}
          </div>
          <div
            className='flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'
            onClick={() => handleAlignNodes(AlignType.DistributeHorizontal)}
          >
            <RiAlignJustify className='h-4 w-4' />
            {t('workflow.operator.distributeHorizontal')}
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(SelectionContextmenu)
