import type { HeaderProps } from '@/app/components/workflow/header'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore as useAppStore } from '@/app/components/app/store'
import Header from '@/app/components/workflow/header'
import { consoleQuery } from '@/service/console'
import { useResetWorkflowVersionHistory } from '@/service/use-workflow'
import { useIsChatMode } from '../../hooks/use-is-chat-mode'
import { difyBuilderHasSessionAtom } from '../dify-builder/store'
import ChatVariableTrigger from './chat-variable-trigger'
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
  const { data: difyBuilderEnabled = false } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.dify_builder_enabled,
    }),
  )
  const hasDifyBuilderSession = useAtomValue(difyBuilderHasSessionAtom)

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
    return {
      normal: {
        components: {
          middle: <FeaturesTrigger />,
          chatVariableTrigger: <ChatVariableTrigger />,
        },
        controls: {
          hasDifyBuilderSession,
          showDifyBuilderButton: difyBuilderEnabled,
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
  }, [
    difyBuilderEnabled,
    hasDifyBuilderSession,
    resetWorkflowVersionHistory,
    isChatMode,
    viewHistoryProps,
  ])
  return <Header {...headerProps} />
}

export default memo(WorkflowHeader)
