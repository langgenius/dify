import type { HeaderProps } from '@/app/components/workflow/header'
import { Separator } from '@langgenius/dify-ui/separator'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useMemo } from 'react'
import { useWorkflowAppSelector as useStore } from '@/app/components/workflow-app/store/workflow'
import {
  isChatflowAtom,
  workflowAppIdentityAtom,
} from '@/app/components/workflow/editor-resource/state'
import Header from '@/app/components/workflow/header'
import { DifyBuilderChecklist } from '@/features/dify-builder/editor/checklist'
import DifyBuilderPanelToggle from '@/features/dify-builder/editor/panel-toggle'
import { consoleQuery } from '@/service/console'
import { useResetWorkflowVersionHistory } from '@/service/use-workflow'
import { WorkflowAppSaveStatus } from '../../draft/save-status'
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
