import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@/app/components/workflow/store'
import {
  useIsChatMode,
} from '../hooks'
import { useStore as useAppStore } from '@/app/components/app/store'
import type { PanelProps } from '@/app/components/workflow/panel'
import Panel from '@/app/components/workflow/panel'
import dynamic from 'next/dynamic'

const MessageLogModal = dynamic(() => import('@/app/components/base/message-log-modal'), {
  ssr: false,
})
const Record = dynamic(() => import('@/app/components/workflow/panel/record'), {
  ssr: false,
})
const ChatRecord = dynamic(() => import('@/app/components/workflow/panel/chat-record'), {
  ssr: false,
})
const DebugAndPreview = dynamic(() => import('@/app/components/workflow/panel/debug-and-preview'), {
  ssr: false,
})
const WorkflowPreview = dynamic(() => import('@/app/components/workflow/panel/workflow-preview'), {
  ssr: false,
})
const ChatVariablePanel = dynamic(() => import('@/app/components/workflow/panel/chat-variable-panel'), {
  ssr: false,
})
const GlobalVariablePanel = dynamic(() => import('@/app/components/workflow/panel/global-variable-panel'), {
  ssr: false,
})
const VersionHistoryPanel = dynamic(() => import('@/app/components/workflow/panel/version-history-panel'), {
  ssr: false,
})

const WorkflowPanelOnLeft = () => {
  const { currentLogItem, setCurrentLogItem, showMessageLogModal, setShowMessageLogModal, currentLogModalActiveTab } = useAppStore(useShallow(state => ({
    currentLogItem: state.currentLogItem,
    setCurrentLogItem: state.setCurrentLogItem,
    showMessageLogModal: state.showMessageLogModal,
    setShowMessageLogModal: state.setShowMessageLogModal,
    currentLogModalActiveTab: state.currentLogModalActiveTab,
  })))
  return (
    <>
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
    </>
  )
}
const WorkflowPanelOnRight = () => {
  const isChatMode = useIsChatMode()
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const showDebugAndPreviewPanel = useStore(s => s.showDebugAndPreviewPanel)
  const showChatVariablePanel = useStore(s => s.showChatVariablePanel)
  const showGlobalVariablePanel = useStore(s => s.showGlobalVariablePanel)
  const showWorkflowVersionHistoryPanel = useStore(s => s.showWorkflowVersionHistoryPanel)

  return (
    <>
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
        showChatVariablePanel && isChatMode && (
          <ChatVariablePanel />
        )
      }
      {
        showGlobalVariablePanel && (
          <GlobalVariablePanel />
        )
      }
      {
        showWorkflowVersionHistoryPanel && (
          <VersionHistoryPanel/>
        )
      }
    </>
  )
}
const WorkflowPanel = () => {
  const panelProps: PanelProps = useMemo(() => {
    return {
      components: {
        left: <WorkflowPanelOnLeft />,
        right: <WorkflowPanelOnRight />,
      },
    }
  }, [])

  return (
    <Panel {...panelProps} />
  )
}

export default WorkflowPanel
