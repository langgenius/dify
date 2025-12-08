import { useCallback, useEffect, useState } from 'react'
import { useBoolean } from 'ahooks'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { fetchMoreLikeThis, updateFeedback } from '@/service/share'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'

export const MAX_DEPTH = 3
export type WorkflowTab = 'RESULT' | 'DETAIL'

export const useMoreLikeThis = (
  messageId: string | null | undefined,
  isInstalledApp: boolean,
  installedAppId: string | undefined,
  controlClearMoreLikeThis: number | undefined,
  isLoading: boolean | undefined,
) => {
  const { t } = useTranslation()
  const [completionRes, setCompletionRes] = useState('')
  const [childMessageId, setChildMessageId] = useState<string | null>(null)
  const [childFeedback, setChildFeedback] = useState<FeedbackType>({ rating: null })
  const [isQuerying, { setTrue: startQuerying, setFalse: stopQuerying }] = useBoolean(false)

  const handleMoreLikeThis = useCallback(async () => {
    if (isQuerying || !messageId) {
      Toast.notify({ type: 'warning', message: t('appDebug.errorMessage.waitForResponse') })
      return
    }
    startQuerying()
    try {
      const res: any = await fetchMoreLikeThis(messageId, isInstalledApp, installedAppId)
      setCompletionRes(res.answer)
      setChildFeedback({ rating: null })
      setChildMessageId(res.id)
    }
    finally {
      stopQuerying()
    }
  }, [isQuerying, messageId, t, startQuerying, isInstalledApp, installedAppId, stopQuerying])

  const handleFeedback = useCallback(async (feedback: FeedbackType) => {
    if (childMessageId) {
      await updateFeedback({ url: `/messages/${childMessageId}/feedbacks`, body: { rating: feedback.rating } }, isInstalledApp, installedAppId)
      setChildFeedback(feedback)
    }
  }, [childMessageId, isInstalledApp, installedAppId])

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
    childMessageId,
    childFeedback,
    isQuerying,
    handleMoreLikeThis,
    handleFeedback,
  }
}

export const useWorkflowTabs = (workflowProcessData?: WorkflowProcess) => {
  const [currentTab, setCurrentTab] = useState<WorkflowTab>('DETAIL')

  useEffect(() => {
    if (workflowProcessData?.resultText || !!workflowProcessData?.files?.length)
      setCurrentTab('RESULT')
    else
      setCurrentTab('DETAIL')
  }, [workflowProcessData?.files?.length, workflowProcessData?.resultText])

  return {
    currentTab,
    setCurrentTab,
  }
}
