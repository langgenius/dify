'use client'

import type { IGenerationItemProps } from './index'
import type { FeedbackType, IChatItem } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import { useBoolean } from 'ahooks'
import copy from 'copy-to-clipboard'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useChatContext } from '@/app/components/base/chat/chat/context'
import { toast } from '@/app/components/base/ui/toast'
import { useParams } from '@/next/navigation'
import { fetchTextGenerationMessage } from '@/service/debug'
import {
  AppSourceType,
  fetchMoreLikeThis,
  submitHumanInputForm,
  updateFeedback,
} from '@/service/share'
import { submitHumanInputForm as submitHumanInputFormService } from '@/service/workflow'

const MAX_DEPTH = 3

const getCurrentTab = (workflowProcessData?: WorkflowProcess) => {
  if (
    workflowProcessData?.resultText
    || !!workflowProcessData?.files?.length
    || !!workflowProcessData?.humanInputFormDataList?.length
    || !!workflowProcessData?.humanInputFilledFormDataList?.length
  ) {
    return 'RESULT'
  }

  return 'DETAIL'
}

const buildLogItem = ({
  answer,
  data,
  messageId,
}: {
  answer?: string
  data: Awaited<ReturnType<typeof fetchTextGenerationMessage>>
  messageId?: string | null
}): IChatItem => {
  const assistantFiles = data.message_files?.filter(file => file.belongs_to === 'assistant') || []
  const normalizedMessage = typeof data.message === 'string'
    ? { role: 'user', text: data.message }
    : data.message
  const baseLog = Array.isArray(normalizedMessage) ? normalizedMessage : [normalizedMessage]
  const log = Array.isArray(normalizedMessage)
    ? [
        ...normalizedMessage,
        ...(normalizedMessage.length > 0 && normalizedMessage[normalizedMessage.length - 1].role !== 'assistant'
          ? [{
              role: 'assistant',
              text: answer || '',
              files: assistantFiles,
            }]
          : []),
      ]
    : baseLog

  return {
    id: data.id || messageId || '',
    content: answer || '',
    isAnswer: true,
    log,
    message_files: data.message_files,
  }
}

type UseGenerationItemParams = Pick<
  IGenerationItemProps,
  | 'appSourceType'
  | 'content'
  | 'controlClearMoreLikeThis'
  | 'depth'
  | 'installedAppId'
  | 'isInWebApp'
  | 'isLoading'
  | 'isMobile'
  | 'isShowTextToSpeech'
  | 'isWorkflow'
  | 'messageId'
  | 'onRetry'
  | 'onSave'
  | 'siteInfo'
  | 'taskId'
  | 'workflowProcessData'
>

type MoreLikeThisState = {
  childFeedback: FeedbackType
  childMessageId: string | null
  completionRes: string
  controlVersion?: number
}

type CurrentTabState = {
  signature: string
  value: string | null
}

type MoreLikeThisResponse = {
  answer?: string
  id?: string
}

const getWorkflowTabSignature = (workflowProcessData?: WorkflowProcess) => JSON.stringify({
  filesLength: workflowProcessData?.files?.length ?? 0,
  humanInputFilledFormDataListLength: workflowProcessData?.humanInputFilledFormDataList?.length ?? 0,
  humanInputFormDataListLength: workflowProcessData?.humanInputFormDataList?.length ?? 0,
  resultText: workflowProcessData?.resultText ?? '',
})

export const useGenerationItem = ({
  appSourceType,
  content,
  controlClearMoreLikeThis,
  depth = 1,
  installedAppId,
  isInWebApp = false,
  isLoading,
  isMobile,
  isShowTextToSpeech,
  isWorkflow,
  messageId,
  onRetry,
  onSave,
  siteInfo,
  taskId,
  workflowProcessData,
}: UseGenerationItemParams) => {
  const { t } = useTranslation()
  const params = useParams()
  const { config } = useChatContext()

  const setCurrentLogItem = useAppStore(state => state.setCurrentLogItem)
  const setShowPromptLogModal = useAppStore(state => state.setShowPromptLogModal)

  const workflowTabSignature = getWorkflowTabSignature(workflowProcessData)
  const workflowDefaultTab = getCurrentTab(workflowProcessData)

  const [moreLikeThisState, setMoreLikeThisState] = useState<MoreLikeThisState>(() => ({
    childFeedback: {
      rating: null,
    },
    childMessageId: null,
    completionRes: '',
    controlVersion: controlClearMoreLikeThis,
  }))
  const [currentTabState, setCurrentTabState] = useState<CurrentTabState>(() => ({
    signature: workflowTabSignature,
    value: null,
  }))
  const [isQuerying, { setTrue: startQuerying, setFalse: stopQuerying }] = useBoolean(false)

  const isTop = depth === 1
  const isTryApp = appSourceType === AppSourceType.tryApp
  const taskLabel = taskId ? `${taskId}${depth > 1 ? `-${depth - 1}` : ''}` : ''
  const isMoreLikeThisCleared = moreLikeThisState.controlVersion !== controlClearMoreLikeThis
  const completionRes = isMoreLikeThisCleared ? '' : moreLikeThisState.completionRes
  const childMessageId = (isLoading || isMoreLikeThisCleared) ? null : moreLikeThisState.childMessageId
  const currentTab = currentTabState.signature === workflowTabSignature && currentTabState.value
    ? currentTabState.value
    : workflowDefaultTab

  const handleChildFeedback = useCallback(async (nextFeedback: FeedbackType) => {
    await updateFeedback(
      {
        url: `/messages/${childMessageId}/feedbacks`,
        body: { rating: nextFeedback.rating },
      },
      appSourceType,
      installedAppId,
    )
    setMoreLikeThisState(prev => ({
      ...prev,
      childFeedback: nextFeedback,
    }))
  }, [appSourceType, childMessageId, installedAppId])

  const handleMoreLikeThis = useCallback(async () => {
    if (isQuerying || !messageId) {
      toast.warning(t('errorMessage.waitForResponse', { ns: 'appDebug' }))
      return
    }

    startQuerying()
    const response = await fetchMoreLikeThis(messageId, appSourceType, installedAppId) as MoreLikeThisResponse
    setMoreLikeThisState({
      childFeedback: { rating: null },
      childMessageId: response.id ?? null,
      completionRes: response.answer ?? '',
      controlVersion: controlClearMoreLikeThis,
    })
    stopQuerying()
  }, [appSourceType, controlClearMoreLikeThis, installedAppId, isQuerying, messageId, startQuerying, stopQuerying, t])

  const handleOpenLogModal = useCallback(async () => {
    const data = await fetchTextGenerationMessage({
      appId: params.appId as string,
      messageId: messageId!,
    })
    const logItem = buildLogItem({
      answer: data.answer,
      data,
      messageId,
    })

    setCurrentLogItem(logItem)
    setShowPromptLogModal(true)
  }, [messageId, params.appId, setCurrentLogItem, setShowPromptLogModal])

  const handleSubmitHumanInputForm = useCallback(async (
    formToken: string,
    formData: { inputs: Record<string, string>, action: string },
  ) => {
    if (appSourceType === AppSourceType.installedApp) {
      await submitHumanInputFormService(formToken, formData)
      return
    }

    await submitHumanInputForm(formToken, formData)
  }, [appSourceType])

  const handleCopy = useCallback(() => {
    const copyContent = isWorkflow ? workflowProcessData?.resultText : content
    if (typeof copyContent === 'string')
      copy(copyContent)
    else
      copy(JSON.stringify(copyContent))

    toast.success(t('actionMsg.copySuccessfully', { ns: 'common' }))
  }, [content, isWorkflow, t, workflowProcessData?.resultText])

  const setCurrentTab = useCallback((tab: string) => {
    setCurrentTabState({
      signature: workflowTabSignature,
      value: tab,
    })
  }, [workflowTabSignature])

  const childProps: IGenerationItemProps = useMemo(() => ({
    appSourceType,
    content: completionRes,
    controlClearMoreLikeThis,
    depth: depth + 1,
    feedback: moreLikeThisState.childFeedback,
    installedAppId,
    isError: false,
    isInWebApp,
    isLoading: isQuerying,
    isMobile,
    isShowTextToSpeech,
    isWorkflow,
    messageId: childMessageId,
    moreLikeThis: true,
    onFeedback: handleChildFeedback,
    onRetry,
    onSave,
    siteInfo,
    taskId,
  }), [
    appSourceType,
    childMessageId,
    completionRes,
    controlClearMoreLikeThis,
    depth,
    handleChildFeedback,
    installedAppId,
    isInWebApp,
    isMobile,
    isQuerying,
    isShowTextToSpeech,
    isWorkflow,
    moreLikeThisState.childFeedback,
    onRetry,
    onSave,
    siteInfo,
    taskId,
  ])

  return {
    childMessageId,
    childProps,
    config,
    completionRes,
    currentTab,
    handleCopy,
    handleMoreLikeThis,
    handleOpenLogModal,
    handleSubmitHumanInputForm,
    isQuerying,
    isTop,
    isTryApp,
    setCurrentTab,
    showChildItem: (childMessageId || isQuerying) && depth < MAX_DEPTH,
    taskLabel,
  }
}

export const generationItemHelpers = {
  buildLogItem,
  getCurrentTab,
}
