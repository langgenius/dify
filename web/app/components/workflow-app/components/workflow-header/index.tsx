import type { HeaderProps } from '@/app/components/workflow/header'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useMemo } from 'react'
import {
  isChatflowAtom,
  workflowAppIdentityAtom,
} from '@/app/components/workflow/editor-resource/state'
import Header from '@/app/components/workflow/header'
import { useStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import { useResetWorkflowVersionHistory } from '@/service/use-workflow'
import { difyBuilderHasSessionAtom } from '../dify-builder/store'
import ChatVariableTrigger from './chat-variable-trigger'
import FeaturesTrigger from './features-trigger'

const WorkflowHeader = () => {
  const { appId } = useAtomValue(workflowAppIdentityAtom)
  const setMessageLogItem = useStore((state) => state.setMessageLogItem)
  const resetWorkflowVersionHistory = useResetWorkflowVersionHistory()
  const isChatflow = useAtomValue(isChatflowAtom)
  const { data: difyBuilderEnabled = false } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.dify_builder_enabled,
    }),
  )
  const hasDifyBuilderSession = useAtomValue(difyBuilderHasSessionAtom)

  const handleClearLogAndMessageModal = useCallback(() => {
    setMessageLogItem(undefined)
  }, [setMessageLogItem])

  const viewHistoryProps = useMemo(() => {
    return {
      onClearLogAndMessageModal: handleClearLogAndMessageModal,
      historyUrl: isChatflow
        ? `/apps/${appId}/advanced-chat/workflow-runs`
        : `/apps/${appId}/workflow-runs`,
    }
  }, [appId, isChatflow, handleClearLogAndMessageModal])

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
          showRunButton: !isChatflow,
          showPreviewButton: isChatflow,
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
    isChatflow,
    viewHistoryProps,
  ])
  return <Header {...headerProps} />
}

export default memo(WorkflowHeader)
