import type { FC } from 'react'
import { memo } from 'react'
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
import ChatVariablePanel from './chat-variable-panel'
import EnvPanel from './env-panel'
import cn from '@/utils/classnames'
import { useStore as useAppStore } from '@/app/components/app/store'
import MessageLogModal from '@/app/components/base/message-log-modal'

const Panel: FC = () => {
  const nodes = useNodes<CommonNodeType>()
  const isChatMode = useIsChatMode()
  const selectedNode = nodes.find(node => node.data.selected)
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const showDebugAndPreviewPanel = useStore(s => s.showDebugAndPreviewPanel)
  const showEnvPanel = useStore(s => s.showEnvPanel)
  const showChatVariablePanel = useStore(s => s.showChatVariablePanel)
  const isRestoring = useStore(s => s.isRestoring)
  const {
    enableShortcuts,
    disableShortcuts,
  } = useWorkflow()
  const { currentLogItem, setCurrentLogItem, showMessageLogModal, setShowMessageLogModal, currentLogModalActiveTab } = useAppStore(useShallow(state => ({
    currentLogItem: state.currentLogItem,
    setCurrentLogItem: state.setCurrentLogItem,
    showMessageLogModal: state.showMessageLogModal,
    setShowMessageLogModal: state.setShowMessageLogModal,
    currentLogModalActiveTab: state.currentLogModalActiveTab,
  })))

  return (
    <div
      tabIndex={-1}
      className={cn('absolute top-14 right-0 bottom-2 flex z-10 outline-none')}
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
            defaultTab={currentLogModalActiveTab}
          />
        )
      }
      {
        !!selectedNode && (
          <NodePanel {...selectedNode!} />
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
        showDebugAndPreviewPanel && isChatMode && (
          <DebugAndPreview />
        )
      }
      {
        showDebugAndPreviewPanel && !isChatMode && (
          <WorkflowPreview />
        )
      }
      {
        showEnvPanel && (
          <EnvPanel />
        )
      }
      {
        showChatVariablePanel && (
          <ChatVariablePanel />
        )
      }
    </div>
  )
}

export default memo(Panel)
