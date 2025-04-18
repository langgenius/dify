import type { FC } from 'react'
import { memo, useEffect, useRef } from 'react'
import { useNodes } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import type { CommonNodeType } from '../types'
import { Panel as NodePanel } from '../nodes'
import { useStore } from '../store'
import {
  useIsChatMode,
} from '../hooks'
import DebugAndPreview from './debug-and-preview'
import Record from './record'
import WorkflowPreview from './workflow-preview'
import ChatRecord from './chat-record'
import ChatVariablePanel from './chat-variable-panel'
import EnvPanel from './env-panel'
import GlobalVariablePanel from './global-variable-panel'
import VersionHistoryPanel from './version-history-panel'
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
  const showGlobalVariablePanel = useStore(s => s.showGlobalVariablePanel)
  const showWorkflowVersionHistoryPanel = useStore(s => s.showWorkflowVersionHistoryPanel)
  const isRestoring = useStore(s => s.isRestoring)
  const { currentLogItem, setCurrentLogItem, showMessageLogModal, setShowMessageLogModal, currentLogModalActiveTab } = useAppStore(useShallow(state => ({
    currentLogItem: state.currentLogItem,
    setCurrentLogItem: state.setCurrentLogItem,
    showMessageLogModal: state.showMessageLogModal,
    setShowMessageLogModal: state.setShowMessageLogModal,
    currentLogModalActiveTab: state.currentLogModalActiveTab,
  })))

  const rightPanelRef = useRef<HTMLDivElement>(null)
  const setRightPanelWidth = useStore(s => s.setRightPanelWidth)

  // get right panel width
  useEffect(() => {
    if (rightPanelRef.current) {
      const resizeRightPanelObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { inlineSize } = entry.borderBoxSize[0]
          setRightPanelWidth(inlineSize)
        }
      })
      resizeRightPanelObserver.observe(rightPanelRef.current)
      return () => {
        resizeRightPanelObserver.disconnect()
      }
    }
  }, [setRightPanelWidth])

  const otherPanelRef = useRef<HTMLDivElement>(null)
  const setOtherPanelWidth = useStore(s => s.setOtherPanelWidth)

  // get other panel width
  useEffect(() => {
    if (otherPanelRef.current) {
      const resizeOtherPanelObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { inlineSize } = entry.borderBoxSize[0]
          setOtherPanelWidth(inlineSize)
        }
      })
      resizeOtherPanelObserver.observe(otherPanelRef.current)
      return () => {
        resizeOtherPanelObserver.disconnect()
      }
    }
  }, [setOtherPanelWidth])
  return (
    <div
      ref={rightPanelRef}
      tabIndex={-1}
      className={cn('absolute bottom-1 right-0 top-14 z-10 flex outline-none')}
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
      <div
        className='relative'
        ref={otherPanelRef}
      >
        {showDebugAndPreviewPanel && isChatMode && (
          <DebugAndPreview />
        )}
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
      </div>
    </div>
  )
}

export default memo(Panel)
