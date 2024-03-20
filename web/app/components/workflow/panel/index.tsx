import type { FC } from 'react'
import {
  memo,
  useMemo,
} from 'react'
import { useNodes } from 'reactflow'
import type { CommonNodeType } from '../types'
import { Panel as NodePanel } from '../nodes'
import { useStore } from '../store'
import { useIsChatMode } from '../hooks'
import WorkflowInfo from './workflow-info'
import DebugAndPreview from './debug-and-preview'
import RunHistory from './run-history'
import Record from './record'
import InputsPanel from './inputs-panel'
import WorkflowPreview from './workflow-preview'
import { useStore as useAppStore } from '@/app/components/app/store'
import MessageLogModal from '@/app/components/base/message-log-modal'

const Panel: FC = () => {
  const nodes = useNodes<CommonNodeType>()
  const isChatMode = useIsChatMode()
  const selectedNode = nodes.find(node => node.data.selected)
  const showRunHistory = useStore(state => state.showRunHistory)
  const showInputsPanel = useStore(s => s.showInputsPanel)
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const { currentLogItem, setCurrentLogItem, showMessageLogModal, setShowMessageLogModal } = useAppStore()
  const {
    showWorkflowInfoPanel,
    showNodePanel,
    showDebugAndPreviewPanel,
    showWorkflowPreview,
  } = useMemo(() => {
    return {
      showWorkflowInfoPanel: !selectedNode && !workflowRunningData && !historyWorkflowData,
      showNodePanel: !!selectedNode && !workflowRunningData && !historyWorkflowData,
      showDebugAndPreviewPanel: isChatMode && workflowRunningData && !historyWorkflowData,
      showWorkflowPreview: !isChatMode && workflowRunningData && !historyWorkflowData,
    }
  }, [
    selectedNode,
    isChatMode,
    workflowRunningData,
    historyWorkflowData,
  ])

  return (
    <div
      className={`
        absolute top-14 right-0 bottom-2 flex pr-2 z-10
        ${(showRunHistory || showDebugAndPreviewPanel) && '!pr-0'}
      `}
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
        historyWorkflowData && (
          <Record />
        )
      }
      {
        showDebugAndPreviewPanel && (
          <DebugAndPreview />
        )
      }
      {
        showInputsPanel && (
          <InputsPanel />
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
      {
        showWorkflowInfoPanel && (
          <WorkflowInfo />
        )
      }
      {
        showRunHistory && (
          <RunHistory />
        )
      }
    </div>
  )
}

export default memo(Panel)
