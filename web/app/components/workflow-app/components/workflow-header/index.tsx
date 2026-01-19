import type { HeaderProps } from '@/app/components/workflow/header'
import { useParams } from 'next/navigation'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { appStoreSelectors, useAppStore } from '@/app/components/app/store'
import Header from '@/app/components/workflow/header'
import { useResetWorkflowVersionHistory } from '@/service/use-workflow'
import { useIsChatMode } from '../../hooks'
import ChatVariableTrigger from './chat-variable-trigger'
import FeaturesTrigger from './features-trigger'

const WorkflowHeader = () => {
  const { appId } = useParams()
  const appDetail = useAppStore(appStoreSelectors.appDetails(appId as string))
  const setCurrentLogItem = useAppStore(state => state.setCurrentLogItem)
  const setShowMessageLogModal = useAppStore(state => state.setShowMessageLogModal)
  const resetWorkflowVersionHistory = useResetWorkflowVersionHistory()
  const isChatMode = useIsChatMode()

  const handleClearLogAndMessageModal = useCallback(() => {
    setCurrentLogItem()
    setShowMessageLogModal(false)
  }, [setCurrentLogItem, setShowMessageLogModal])

  const viewHistoryProps = useMemo(() => {
    return {
      onClearLogAndMessageModal: handleClearLogAndMessageModal,
      historyUrl: isChatMode ? `/apps/${appDetail!.id}/advanced-chat/workflow-runs` : `/apps/${appDetail!.id}/workflow-runs`,
    }
  }, [appDetail, isChatMode, handleClearLogAndMessageModal])

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
  return (
    <Header {...headerProps} />
  )
}

export default memo(WorkflowHeader)
