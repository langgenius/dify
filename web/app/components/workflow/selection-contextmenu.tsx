import type { AlignTypeValue } from './selection-contextmenu.helpers'
import { useClickAway } from 'ahooks'
import { produce } from 'immer'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useReactFlowStore, useStoreApi } from 'reactflow'
import { useNodesReadOnly, useNodesSyncDraft } from './hooks'
import { useSelectionInteractions } from './hooks/use-selection-interactions'
import { useWorkflowHistory, WorkflowHistoryEvent } from './hooks/use-workflow-history'
import {
  alignNodePosition,
  AlignType,
  distributeNodes,
  getAlignableNodes,
  getAlignBounds,
  getMenuPosition,
  MENU_SECTIONS,
} from './selection-contextmenu.helpers'
import { useStore, useWorkflowStore } from './store'

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
    const container = document.querySelector('#workflow-container')
    return getMenuPosition(selectionMenu, container?.getBoundingClientRect())
  }, [selectionMenu])

  useClickAway(() => {
    handleSelectionContextmenuCancel()
  }, ref)

  useEffect(() => {
    if (selectionMenu && selectedNodes.length <= 1)
      handleSelectionContextmenuCancel()
  }, [selectionMenu, selectedNodes.length, handleSelectionContextmenuCancel])

  const handleAlignNodes = useCallback((alignType: AlignTypeValue) => {
    if (getNodesReadOnly() || selectedNodes.length <= 1) {
      handleSelectionContextmenuCancel()
      return
    }

    // Disable node animation state - same as handleNodeDragStart
    workflowStore.setState({ nodeAnimation: false })

    // Get all current nodes
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
      ref={ref}
    >
      <div ref={menuRef} className="w-[240px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl">
        {MENU_SECTIONS.map((section, sectionIndex) => (
          <div key={section.titleKey}>
            {sectionIndex > 0 && <div className="h-px bg-divider-regular"></div>}
            <div className="p-1">
              <div className="system-xs-medium px-2 py-2 text-text-tertiary">
                {t(section.titleKey, { defaultValue: section.titleKey, ns: 'workflow' })}
              </div>
              {section.items.map((item) => {
                const Icon = item.icon
                return (
                  <div
                    key={item.alignType}
                    className="flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover"
                    data-testid={`selection-contextmenu-item-${item.alignType}`}
                    onClick={() => handleAlignNodes(item.alignType)}
                  >
                    <Icon className={`h-4 w-4 ${item.iconClassName ?? ''}`.trim()} />
                    {t(item.translationKey, { defaultValue: item.translationKey, ns: 'workflow' })}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default memo(SelectionContextmenu)
