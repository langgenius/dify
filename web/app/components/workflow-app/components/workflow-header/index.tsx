import type { HeaderProps } from '@/app/components/workflow/header'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useMemo } from 'react'
import { editorResourceAtom, isChatflowAtom } from '@/app/components/workflow/editor-resource/state'
import Header from '@/app/components/workflow/header'
import { useStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import { workflowVersionHistoryKey } from '@/service/workflow-queries'
import { difyBuilderHasSessionAtom } from '../dify-builder/store'
import ChatVariableTrigger from './chat-variable-trigger'
import FeaturesTrigger from './features-trigger'

const WorkflowHeader = () => {
  const setMessageLogItem = useStore((state) => state.setMessageLogItem)
  const queryClient = useQueryClient()
  const resource = useAtomValue(editorResourceAtom)
  const resetWorkflowVersionHistory = useCallback(
    () => queryClient.resetQueries({ queryKey: workflowVersionHistoryKey(resource) }),
    [queryClient, resource],
  )
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
    }
  }, [handleClearLogAndMessageModal])

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
