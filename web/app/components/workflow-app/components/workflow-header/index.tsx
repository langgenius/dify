import type { HeaderProps } from '@/app/components/workflow/header'
import { Separator } from '@langgenius/dify-ui/separator'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useMemo } from 'react'
import { useWorkflowAppSelector as useStore } from '@/app/components/workflow-app/store/workflow'
import { editorResourceAtom, isChatflowAtom } from '@/app/components/workflow/editor-resource/state'
import Header from '@/app/components/workflow/header'
import { DifyBuilderChecklist } from '@/features/dify-builder/editor/checklist'
import DifyBuilderPanelToggle from '@/features/dify-builder/editor/panel-toggle'
import { useWorkflowDifyBuilderEnabled } from '@/features/dify-builder/editor/use-enabled'
import { workflowVersionHistoryKey } from '@/service/workflow-queries'
import { WorkflowAppSaveStatus } from '../../draft/save-status'
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
  const difyBuilderEnabled = useWorkflowDifyBuilderEnabled()

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
          title: <WorkflowAppSaveStatus />,
          middle: <FeaturesTrigger />,
          chatVariableTrigger: <ChatVariableTrigger />,
          actions: difyBuilderEnabled && (
            <>
              <Separator decorative orientation="vertical" className="mx-0 h-4" />
              <DifyBuilderPanelToggle />
            </>
          ),
        },
        runAndHistoryProps: {
          showRunButton: !isChatflow,
          showPreviewButton: isChatflow,
          viewHistoryProps,
          components: { Checklist: DifyBuilderChecklist },
        },
      },
      viewHistory: {
        viewHistoryProps,
      },
      restoring: {
        onRestoreSettled: resetWorkflowVersionHistory,
      },
    }
  }, [difyBuilderEnabled, resetWorkflowVersionHistory, isChatflow, viewHistoryProps])
  return <Header {...headerProps} />
}

export default memo(WorkflowHeader)
