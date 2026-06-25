import type { OffsetOptions } from '@floating-ui/react'
import type {
  OnSelectBlock,
} from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RiAddCircleFill } from '@remixicon/react'
import { produce } from 'immer'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import BlockSelector from '@/app/components/workflow/block-selector'
import {
  BlockEnum,
} from '@/app/components/workflow/types'
import { FlowType } from '@/types/common'
import {
  useAvailableBlocks,
  useIsChatMode,
  useNodesMetaData,
  useNodesReadOnly,
  usePanelInteractions,
} from '../hooks'
import { useHooksStore } from '../hooks-store'
import { useCollaborativeWorkflow } from '../hooks/use-collaborative-workflow'
import { useNodesSyncDraft } from '../hooks/use-nodes-sync-draft'
import { useWorkflowHistory, WorkflowHistoryEvent } from '../hooks/use-workflow-history'
import { useCreateInlineAgentBinding } from '../nodes/agent-v2/hooks'
import { isAgentV2NodeData, needsInlineAgentBindingCreation } from '../nodes/agent-v2/types'
import { useStore, useWorkflowStore } from '../store'
import {
  generateNewNode,
  getNodeCustomTypeByNodeDataType,
  getNodesWithSameDefaultDataType,
} from '../utils'
import TipPopup from './tip-popup'

type AddBlockProps = {
  renderTrigger?: (open: boolean) => React.ReactNode
  renderTriggerAsButtonRoot?: boolean
  offset?: OffsetOptions
  onClose?: () => void
}
const AddBlock = ({
  renderTrigger,
  renderTriggerAsButtonRoot,
  offset,
  onClose,
}: AddBlockProps) => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const reactflow = useReactFlow()
  const workflowStore = useWorkflowStore()
  const mousePosition = useStore(s => s.mousePosition)
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const isChatMode = useIsChatMode()
  const { nodesReadOnly } = useNodesReadOnly()
  const { handlePaneContextmenuCancel } = usePanelInteractions()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { saveStateToHistory } = useWorkflowHistory()
  const { createInlineAgentBinding } = useCreateInlineAgentBinding()
  const [open, setOpen] = useState(false)
  const { availableNextBlocks } = useAvailableBlocks(BlockEnum.Start, false)
  const { nodesMap: nodesMetaDataMap } = useNodesMetaData()
  const flowType = useHooksStore(s => s.configsMap?.flowType)
  const showStartTab = flowType !== FlowType.ragPipeline && !isChatMode

  const handleOpenChange = useCallback((open: boolean) => {
    setOpen(open)
    if (!open)
      (onClose ?? handlePaneContextmenuCancel)()
  }, [handlePaneContextmenuCancel, onClose])

  const handleSelect = useCallback<OnSelectBlock>((type, pluginDefaultValue) => {
    const {
      getNodes,
    } = store.getState()
    const {
      defaultValue,
    } = nodesMetaDataMap![type]
    const nodes = getNodes()
    const nodesWithSameType = getNodesWithSameDefaultDataType(nodes, type, defaultValue)
    const { newNode } = generateNewNode({
      type: getNodeCustomTypeByNodeDataType(type),
      data: {
        ...(defaultValue as any),
        title: nodesWithSameType.length > 0 ? `${defaultValue.title} ${nodesWithSameType.length + 1}` : defaultValue.title,
        ...pluginDefaultValue,
        _isCandidate: true,
      },
      position: {
        x: 0,
        y: 0,
      },
    })
    if (isAgentV2NodeData(newNode.data) && needsInlineAgentBindingCreation(newNode.data)) {
      const { nodes, setNodes } = collaborativeWorkflow.getState()
      const { screenToFlowPosition } = reactflow
      const position = screenToFlowPosition({
        x: mousePosition.pageX,
        y: mousePosition.pageY,
      })
      const nodeToInsert = {
        ...newNode,
        data: {
          ...newNode.data,
          _isCandidate: false,
          _isTempNode: true,
          selected: true,
        },
        position,
      }
      setNodes(produce(nodes, (draft) => {
        draft.forEach((node) => {
          node.data.selected = false
        })
        draft.push(nodeToInsert)
      }))
      workflowStore.setState({
        candidateNode: undefined,
      })
      saveStateToHistory(WorkflowHistoryEvent.NodeAdd, { nodeId: newNode.id })
      createInlineAgentBinding(newNode.id, {
        onSuccess: (binding) => {
          const { nodes, setNodes } = collaborativeWorkflow.getState()
          setNodes(produce(nodes, (draft) => {
            const node = draft.find(node => node.id === newNode.id)
            if (node) {
              if (isAgentV2NodeData(node.data) && needsInlineAgentBindingCreation(node.data))
                node.data.agent_binding = binding
              node.data._openInlineAgentPanel = true
              delete node.data._isTempNode
            }
          }))
          workflowStore.getState().setOpenInlineAgentPanelNodeId(newNode.id)
          handleSyncWorkflowDraft(true, true)
        },
      })
      setOpen(false)
      return
    }
    workflowStore.setState({
      candidateNode: newNode,
    })
  }, [collaborativeWorkflow, createInlineAgentBinding, handleSyncWorkflowDraft, mousePosition.pageX, mousePosition.pageY, reactflow, saveStateToHistory, store, workflowStore, nodesMetaDataMap])

  const renderTriggerElement = useCallback((open: boolean) => {
    return (
      <TipPopup
        title={t('common.addBlock', { ns: 'workflow' })}
      >
        <div className={cn(
          'flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          `${nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
          open && 'bg-state-accent-active text-text-accent',
        )}
        >
          <RiAddCircleFill className="size-4" />
        </div>
      </TipPopup>
    )
  }, [nodesReadOnly, t])

  return (
    <BlockSelector
      open={open}
      onOpenChange={handleOpenChange}
      disabled={nodesReadOnly}
      onSelect={handleSelect}
      placement="right-start"
      offset={offset ?? {
        mainAxis: 4,
        crossAxis: -8,
      }}
      trigger={renderTrigger || renderTriggerElement}
      renderTriggerAsButtonRoot={renderTriggerAsButtonRoot}
      popupClassName="min-w-[256px]!"
      availableBlocksTypes={availableNextBlocks}
      showStartTab={showStartTab}
    />
  )
}

export default memo(AddBlock)
