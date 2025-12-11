'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { RiSparklingFill } from '@remixicon/react'
import copy from 'copy-to-clipboard'
import { useParams } from 'next/navigation'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import { fetchMoreLikeThis, updateFeedback } from '@/service/share'
import { fetchTextGenerationMessage } from '@/service/debug'
import { useStore as useAppStore } from '@/app/components/app/store'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { SiteInfo } from '@/models/share'
import { useChatContext } from '@/app/components/base/chat/chat/context'
import cn from '@/utils/classnames'
import ContentSection from './content-section'
import MetaSection from './meta-section'
import { useMoreLikeThisState, useWorkflowTabs } from './hooks'

const MAX_DEPTH = 3

export type IGenerationItemProps = {
  isWorkflow?: boolean
  workflowProcessData?: WorkflowProcess
  className?: string
  isError: boolean
  onRetry: () => void
  content: any
  messageId?: string | null
  conversationId?: string
  isLoading?: boolean
  isResponding?: boolean
  isInWebApp?: boolean
  moreLikeThis?: boolean
  depth?: number
  feedback?: FeedbackType
  onFeedback?: (feedback: FeedbackType) => void
  onSave?: (messageId: string) => void
  isMobile?: boolean
  isInstalledApp: boolean
  installedAppId?: string
  taskId?: string
  controlClearMoreLikeThis?: number
  supportFeedback?: boolean
  isShowTextToSpeech?: boolean
  hideProcessDetail?: boolean
  siteInfo: SiteInfo | null
  inSidePanel?: boolean
}

export const copyIcon = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9.3335 2.33341C9.87598 2.33341 10.1472 2.33341 10.3698 2.39304C10.9737 2.55486 11.4454 3.02657 11.6072 3.63048C11.6668 3.85302 11.6668 4.12426 11.6668 4.66675V10.0334C11.6668 11.0135 11.6668 11.5036 11.4761 11.8779C11.3083 12.2072 11.0406 12.4749 10.7113 12.6427C10.337 12.8334 9.84692 12.8334 8.86683 12.8334H5.1335C4.1534 12.8334 3.66336 12.8334 3.28901 12.6427C2.95973 12.4749 2.69201 12.2072 2.52423 11.8779C2.3335 11.5036 2.3335 11.0135 2.3335 10.0334V4.66675C2.3335 4.12426 2.3335 3.85302 2.39313 3.63048C2.55494 3.02657 3.02665 2.55486 3.63056 2.39304C3.8531 2.33341 4.12435 2.33341 4.66683 2.33341M5.60016 3.50008H8.40016C8.72686 3.50008 8.89021 3.50008 9.01499 3.4365C9.12475 3.38058 9.21399 3.29134 9.26992 3.18158C9.3335 3.05679 9.3335 2.89345 9.3335 2.56675V2.10008C9.3335 1.77338 9.3335 1.61004 9.26992 1.48525C9.21399 1.37549 9.12475 1.28625 9.01499 1.23033C8.89021 1.16675 8.72686 1.16675 8.40016 1.16675H5.60016C5.27347 1.16675 5.11012 1.16675 4.98534 1.23033C4.87557 1.28625 4.78634 1.37549 4.73041 1.48525C4.66683 1.61004 4.66683 1.77338 4.66683 2.10008V2.56675C4.66683 2.89345 4.66683 3.05679 4.73041 3.18158C4.78634 3.29134 4.87557 3.38058 4.98534 3.4365C5.11012 3.50008 5.27347 3.50008 5.60016 3.50008Z" stroke="#344054" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const formatLogItem = (data: any) => {
  if (Array.isArray(data.message)) {
    const assistantLog = data.message[data.message.length - 1]?.role !== 'assistant'
      ? [{
        role: 'assistant',
        text: data.answer,
        files: data.message_files?.filter((file: any) => file.belongs_to === 'assistant') || [],
      }]
      : []

    return {
      ...data,
      log: [
        ...data.message,
        ...assistantLog,
      ],
    }
  }

  const message = typeof data.message === 'string'
    ? { text: data.message }
    : data.message

  return {
    ...data,
    log: [message],
  }
}

const GenerationItem: FC<IGenerationItemProps> = ({
  isWorkflow,
  workflowProcessData,
  className,
  isError,
  onRetry,
  content,
  messageId,
  isLoading,
  isResponding,
  moreLikeThis,
  isInWebApp = false,
  feedback,
  onFeedback,
  onSave,
  depth = 1,
  isMobile,
  isInstalledApp,
  installedAppId,
  taskId,
  controlClearMoreLikeThis,
  supportFeedback,
  isShowTextToSpeech,
  hideProcessDetail,
  siteInfo,
  inSidePanel,
}) => {
  const { t } = useTranslation()
  const params = useParams()
  const isTop = depth === 1
  const {
    completionRes,
    setCompletionRes,
    childMessageId,
    setChildMessageId,
    childFeedback,
    setChildFeedback,
    isQuerying,
    startQuerying,
    stopQuerying,
  } = useMoreLikeThisState({ controlClearMoreLikeThis, isLoading })
  const { currentTab, setCurrentTab, showResultTabs } = useWorkflowTabs(workflowProcessData)
  const { config } = useChatContext()
  const setCurrentLogItem = useAppStore(s => s.setCurrentLogItem)
  const setShowPromptLogModal = useAppStore(s => s.setShowPromptLogModal)

  const handleFeedback = useCallback(async (nextFeedback: FeedbackType) => {
    if (!childMessageId)
      return
    await updateFeedback(
      { url: `/messages/${childMessageId}/feedbacks`, body: { rating: nextFeedback.rating } },
      isInstalledApp,
      installedAppId,
    )
    setChildFeedback(nextFeedback)
  }, [childMessageId, installedAppId, isInstalledApp, setChildFeedback])

  const handleMoreLikeThis = useCallback(async () => {
    if (isQuerying || !messageId) {
      Toast.notify({ type: 'warning', message: t('appDebug.errorMessage.waitForResponse') })
      return
    }
    startQuerying()
    try {
      const res: any = await fetchMoreLikeThis(messageId as string, isInstalledApp, installedAppId)
      setCompletionRes(res.answer)
      setChildFeedback({ rating: null })
      setChildMessageId(res.id)
    }
    finally {
      stopQuerying()
    }
  }, [
    installedAppId,
    isInstalledApp,
    isQuerying,
    messageId,
    setChildFeedback,
    setChildMessageId,
    setCompletionRes,
    startQuerying,
    stopQuerying,
    t,
  ])

  const handleOpenLogModal = useCallback(async () => {
    if (!messageId)
      return
    const data = await fetchTextGenerationMessage({
      appId: params.appId as string,
      messageId,
    })
    const logItem = formatLogItem(data)
    setCurrentLogItem(logItem)
    setShowPromptLogModal(true)
  }, [messageId, params.appId, setCurrentLogItem, setShowPromptLogModal])

  const copyContent = isWorkflow ? workflowProcessData?.resultText : content
  const handleCopy = useCallback(() => {
    if (typeof copyContent === 'string')
      copy(copyContent)
    else
      copy(JSON.stringify(copyContent))
    Toast.notify({ type: 'success', message: t('common.actionMsg.copySuccessfully') })
  }, [copyContent, t])

  const shouldIndentForChild = Boolean(isMobile && (childMessageId || isQuerying) && depth < MAX_DEPTH)
  const shouldRenderChild = (childMessageId || isQuerying) && depth < MAX_DEPTH
  const canCopy = (currentTab === 'RESULT' && workflowProcessData?.resultText) || !isWorkflow
  const childProps: IGenerationItemProps = {
    isWorkflow,
    className,
    isError: false,
    onRetry,
    content: completionRes,
    messageId: childMessageId,
    isLoading: isQuerying,
    isResponding,
    moreLikeThis: true,
    depth: depth + 1,
    onFeedback: handleFeedback,
    feedback: childFeedback,
    onSave,
    isShowTextToSpeech,
    isMobile,
    isInstalledApp,
    installedAppId,
    controlClearMoreLikeThis,
    isInWebApp: true,
    siteInfo,
    taskId,
    inSidePanel,
    hideProcessDetail,
  }

  return (
    <>
      <div className={cn('relative', !isTop && 'mt-3', className)}>
        {isLoading && (
          <div className={cn('flex h-10 items-center', !inSidePanel && 'rounded-2xl border-t border-divider-subtle bg-chat-bubble-bg')}><Loading type='area' /></div>
        )}
        {!isLoading && (
          <>
            <ContentSection
              workflowProcessData={workflowProcessData}
              taskId={taskId}
              depth={depth}
              isError={isError}
              content={content}
              hideProcessDetail={hideProcessDetail}
              siteInfo={siteInfo}
              currentTab={currentTab}
              onSwitchTab={setCurrentTab}
              showResultTabs={showResultTabs}
              t={t}
              inSidePanel={inSidePanel}
            />
            <MetaSection
              showCharCount={!isWorkflow}
              charCount={content?.length}
              t={t}
              shouldIndentForChild={shouldIndentForChild}
              isInWebApp={isInWebApp}
              isInstalledApp={isInstalledApp}
              isResponding={isResponding}
              isError={isError}
              messageId={messageId}
              onOpenLogModal={handleOpenLogModal}
              moreLikeThis={moreLikeThis}
              onMoreLikeThis={handleMoreLikeThis}
              disableMoreLikeThis={depth === MAX_DEPTH}
              isShowTextToSpeech={isShowTextToSpeech}
              textToSpeechVoice={config?.text_to_speech?.voice}
              canCopy={!!canCopy}
              onCopy={handleCopy}
              onRetry={onRetry}
              isWorkflow={isWorkflow}
              onSave={onSave}
              feedback={feedback}
              onFeedback={onFeedback}
              supportFeedback={supportFeedback}
            />
            {/* more like this elements */}
            {!isTop && (
              <div className={cn(
                'absolute top-[-32px] flex h-[33px] w-4 justify-center',
                isMobile ? 'left-[17px]' : 'left-[50%] translate-x-[-50%]',
              )}>
                <div className='h-full w-0.5 bg-divider-regular'></div>
                <div className={cn(
                  'absolute left-0 flex h-4 w-4 items-center justify-center rounded-2xl border-[0.5px] border-divider-subtle bg-util-colors-blue-blue-500 shadow-xs',
                  isMobile ? 'top-[3.5px]' : 'top-2',
                )}>
                  <RiSparklingFill className='h-3 w-3 text-text-primary-on-surface' />
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {shouldRenderChild && (
        <GenerationItem {...childProps} />
      )}
    </>
  )
}
export default React.memo(GenerationItem)
