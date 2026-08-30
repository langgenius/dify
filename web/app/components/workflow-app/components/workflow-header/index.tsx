import type { HeaderProps } from '@/app/components/workflow/header'
import { useQuery } from '@tanstack/react-query'
import { memo, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore as useAppStore } from '@/app/components/app/store'
import Header from '@/app/components/workflow/header'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { consoleQuery } from '@/service/client'
import { useResetWorkflowVersionHistory } from '@/service/use-workflow'
import { useIsChatMode } from '../../hooks/use-is-chat-mode'
import ChatVariableTrigger from './chat-variable-trigger'
import DifyBuilderTrigger from './dify-builder-trigger'
import FeaturesTrigger from './features-trigger'

const WorkflowHeader = () => {
  const { appDetail, setCurrentLogItem, setShowMessageLogModal } = useAppStore(
    useShallow((state) => ({
      appDetail: state.appDetail,
      setCurrentLogItem: state.setCurrentLogItem,
      setShowMessageLogModal: state.setShowMessageLogModal,
    })),
  )
  const resetWorkflowVersionHistory = useResetWorkflowVersionHistory()
  const isChatMode = useIsChatMode()
  const canEdit = useHooksStore((state) => state.accessControl.canEdit)
  const { data: features } = useQuery(consoleQuery.features.get.queryOptions())
  const showDifyBuilder = canEdit && features?.dify_builder_enabled === true

  const handleClearLogAndMessageModal = useCallback(() => {
    setCurrentLogItem()
    setShowMessageLogModal(false)
  }, [setCurrentLogItem, setShowMessageLogModal])

  const viewHistoryProps = useMemo(() => {
    return {
      onClearLogAndMessageModal: handleClearLogAndMessageModal,
      historyUrl: isChatMode
        ? `/apps/${appDetail!.id}/advanced-chat/workflow-runs`
        : `/apps/${appDetail!.id}/workflow-runs`,
    }
  }, [appDetail, isChatMode, handleClearLogAndMessageModal])

  const headerProps: HeaderProps = useMemo(() => {
    const difyBuilderTrigger = showDifyBuilder ? <DifyBuilderTrigger /> : undefined
    return {
      normal: {
        components: {
          middle: <FeaturesTrigger />,
          chatVariableTrigger: <ChatVariableTrigger />,
          trailing: difyBuilderTrigger,
        },
        runAndHistoryProps: {
          showRunButton: !isChatMode,
          showPreviewButton: isChatMode,
          viewHistoryProps,
        },
      },
      viewHistory: {
        viewHistoryProps,
        trailing: difyBuilderTrigger,
      },
      restoring: {
        onRestoreSettled: resetWorkflowVersionHistory,
        trailing: difyBuilderTrigger,
      },
    }
  }, [resetWorkflowVersionHistory, isChatMode, showDifyBuilder, viewHistoryProps])
  return <Header {...headerProps} />
}

export default memo(WorkflowHeader)
