import { useBoolean } from 'ahooks'
import { useEffect, useState } from 'react'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'

type UseMoreLikeThisStateParams = {
  controlClearMoreLikeThis?: number
  isLoading?: boolean
}

export const useMoreLikeThisState = ({
  controlClearMoreLikeThis,
  isLoading,
}: UseMoreLikeThisStateParams) => {
  const [completionRes, setCompletionRes] = useState('')
  const [childMessageId, setChildMessageId] = useState<string | null>(null)
  const [childFeedback, setChildFeedback] = useState<FeedbackType>({
    rating: null,
  })
  const [isQuerying, { setTrue: startQuerying, setFalse: stopQuerying }] = useBoolean(false)

  useEffect(() => {
    if (controlClearMoreLikeThis) {
      setChildMessageId(null)
      setCompletionRes('')
    }
  }, [controlClearMoreLikeThis])

  useEffect(() => {
    if (isLoading)
      setChildMessageId(null)
  }, [isLoading])

  return {
    completionRes,
    setCompletionRes,
    childMessageId,
    setChildMessageId,
    childFeedback,
    setChildFeedback,
    isQuerying,
    startQuerying,
    stopQuerying,
  }
}

export const useWorkflowTabs = (workflowProcessData?: WorkflowProcess) => {
  const [currentTab, setCurrentTab] = useState<'DETAIL' | 'RESULT'>('DETAIL')
  const showResultTabs = !!workflowProcessData?.resultText || !!workflowProcessData?.files?.length

  useEffect(() => {
    if (showResultTabs)
      setCurrentTab('RESULT')
    else
      setCurrentTab('DETAIL')
  }, [
    showResultTabs,
    workflowProcessData?.resultText,
    workflowProcessData?.files?.length,
  ])

  return {
    currentTab,
    setCurrentTab,
    showResultTabs,
  }
}
