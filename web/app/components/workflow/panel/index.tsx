import type { FC } from 'react'
import {
  memo,
  useMemo,
} from 'react'
import { useNodes } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import type { CommonNodeType } from '../types'
import { Panel as NodePanel } from '../nodes'
import { useStore } from '../store'
import {
  useIsChatMode,
  useWorkflow,
} from '../hooks'
import DebugAndPreview from './debug-and-preview'
import Record from './record'
import WorkflowPreview from './workflow-preview'
import ChatRecord from './chat-record'
import { useStore as useAppStore } from '@/app/components/app/store'
import MessageLogModal from '@/app/components/base/message-log-modal'

const Panel: FC = () => {
  const nodes = useNodes<CommonNodeType>()
  const isChatMode = useIsChatMode()
  const selectedNode = nodes.find(node => node.data.selected)
  const showInputsPanel = useStore(s => s.showInputsPanel)
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const isRestoring = useStore(s => s.isRestoring)
  const {
    enableShortcuts,
    disableShortcuts,
  } = useWorkflow()
  const { currentLogItem, setCurrentLogItem, showMessageLogModal, setShowMessageLogModal } = useAppStore(useShallow(state => ({
    currentLogItem: state.currentLogItem,
    setCurrentLogItem: state.setCurrentLogItem,
    showMessageLogModal: state.showMessageLogModal,
    setShowMessageLogModal: state.setShowMessageLogModal,
  })))
  const {
    showNodePanel,
    showDebugAndPreviewPanel,
    showWorkflowPreview,
  } = useMemo(() => {
    return {
      showNodePanel: !!selectedNode && !workflowRunningData && !historyWorkflowData && !showInputsPanel,
      showDebugAndPreviewPanel: isChatMode && workflowRunningData && !historyWorkflowData,
      showWorkflowPreview: !isChatMode && !historyWorkflowData && (workflowRunningData || showInputsPanel),
    }
  }, [
    showInputsPanel,
    selectedNode,
    isChatMode,
    workflowRunningData,
    historyWorkflowData,
  ])

  return (
    <div
      tabIndex={-1}
      className='absolute top-14 right-0 bottom-2 flex z-10 outline-none'
      onFocus={disableShortcuts}
      onBlur={enableShortcuts}
      key={`${isRestoring}`}
    >
      {
        showMessageLogModal && (
          <MessageLogModal
            fixedWidth
            width={400}
            currentLogItem={currentLogItem}
            onCancel={() => {
              setCurrentLogItem()
              setShowMessageLogModal(false)
            }}
          />
        )
      }
      {
        historyWorkflowData && !isChatMode && (
          <Record />
        )
      }
      {
        historyWorkflowData && isChatMode && (
          <ChatRecord />
        )
      }
      {
        showDebugAndPreviewPanel && (
          <DebugAndPreview />
        )
      }
      {
        showWorkflowPreview && (
          <WorkflowPreview />
        )
      }
      {
        showNodePanel && (
          <NodePanel {...selectedNode!} />
        )
      }
    </div>
  )
}

export default memo(Panel)
