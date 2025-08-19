import { useMemo } from 'react'
import type { HeaderProps } from '@/app/components/workflow/header'
import Header from '@/app/components/workflow/header'
import { useStore as useAppStore } from '@/app/components/app/store'
import ChatVariableTrigger from './chat-variable-trigger'
import AppPublisherTrigger from './app-publisher-trigger'
import { useResetWorkflowVersionHistory } from '@/service/use-workflow'

const WorkflowHeader = () => {
  const appDetail = useAppStore(s => s.appDetail)
  const resetWorkflowVersionHistory = useResetWorkflowVersionHistory(appDetail!.id)

  const headerProps: HeaderProps = useMemo(() => {
    return {
      normal: {
        components: {
          left: <ChatVariableTrigger />,
          middle: <AppPublisherTrigger />,
        },
      },
      restoring: {
        onRestoreSettled: resetWorkflowVersionHistory,
      },
    }
  }, [resetWorkflowVersionHistory])
  return (
    <Header {...headerProps} />
  )
}

export default WorkflowHeader
