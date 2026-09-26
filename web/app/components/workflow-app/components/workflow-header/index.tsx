import type { HeaderProps } from '@/app/components/workflow/header'
import { memo, useCallback, useMemo } from 'react'
import Header from '@/app/components/workflow/header'
import { useStore } from '@/app/components/workflow/store'
import { useResetWorkflowVersionHistory } from '@/service/use-workflow'
import { useIsChatMode } from '../../hooks/use-is-chat-mode'
import ChatVariableTrigger from './chat-variable-trigger'
import FeaturesTrigger from './features-trigger'

const WorkflowHeader = () => {
  const appId = useStore((state) => state.appId)
  const setMessageLogItem = useStore((state) => state.setMessageLogItem)
  const resetWorkflowVersionHistory = useResetWorkflowVersionHistory()
  const isChatMode = useIsChatMode()

  const handleClearLogAndMessageModal = useCallback(() => {
    setMessageLogItem(undefined)
  }, [setMessageLogItem])

  const viewHistoryProps = useMemo(() => {
    return {
      onClearLogAndMessageModal: handleClearLogAndMessageModal,
      historyUrl: appId
        ? isChatMode
          ? `/apps/${appId}/advanced-chat/workflow-runs`
          : `/apps/${appId}/workflow-runs`
        : undefined,
    }
  }, [appId, isChatMode, handleClearLogAndMessageModal])

  const headerProps: HeaderProps = useMemo(() => {
    return {
      normal: {
        components: {
          middle: <FeaturesTrigger />,
          chatVariableTrigger: <ChatVariableTrigger />,
        },
        runAndHistoryProps: {
          showRunButton: !isChatMode,
          showPreviewButton: isChatMode,
          viewHistoryProps,
        },
      },
      viewHistory: {
        viewHistoryProps,
      },
      restoring: {
        onRestoreSettled: resetWorkflowVersionHistory,
      },
    }
  }, [resetWorkflowVersionHistory, isChatMode, viewHistoryProps])
  return <Header {...headerProps} />
}

export default memo(WorkflowHeader)
