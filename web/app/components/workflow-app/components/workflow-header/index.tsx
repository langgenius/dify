import type { HeaderProps } from '@/app/components/workflow/header'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useMemo } from 'react'
import { isChatflowAtom } from '@/app/components/workflow/editor-resource/state'
import Header from '@/app/components/workflow/header'
import { useStore } from '@/app/components/workflow/store'
import { useResetWorkflowVersionHistory } from '@/service/use-workflow'
import ChatVariableTrigger from './chat-variable-trigger'
import FeaturesTrigger from './features-trigger'

const WorkflowHeader = () => {
  const setMessageLogItem = useStore((state) => state.setMessageLogItem)
  const resetWorkflowVersionHistory = useResetWorkflowVersionHistory()
  const isChatflow = useAtomValue(isChatflowAtom)

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
  }, [resetWorkflowVersionHistory, isChatflow, viewHistoryProps])
  return <Header {...headerProps} />
}

export default memo(WorkflowHeader)
