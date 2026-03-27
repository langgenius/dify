'use client'
import type { FC } from 'react'
import type { FeedbackType, IChatItem } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { SiteInfo } from '@/models/share'
import {
  RiPlayList2Line,
  RiSparklingFill,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useChatContext } from '@/app/components/base/chat/chat/context'
import Loading from '@/app/components/base/loading'
import { Markdown } from '@/app/components/base/markdown'
import { toast } from '@/app/components/base/ui/toast'
import { useParams } from '@/next/navigation'
import { fetchTextGenerationMessage } from '@/service/debug'
import { AppSourceType, fetchMoreLikeThis, submitHumanInputForm, updateFeedback } from '@/service/share'
import { submitHumanInputForm as submitHumanInputFormService } from '@/service/workflow'
import { cn } from '@/utils/classnames'
import GenerationItemActionBar from './action-bar'
import WorkflowContent from './workflow-content'

const MAX_DEPTH = 3

export type IGenerationItemProps = {
  isWorkflow?: boolean
  workflowProcessData?: WorkflowProcess
  className?: string
  isError: boolean
  onRetry: () => void
  content: unknown
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
  appSourceType: AppSourceType
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
  appSourceType,
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
  const isTryApp = appSourceType === AppSourceType.tryApp
  const [completionRes, setCompletionRes] = useState('')
  const [childMessageId, setChildMessageId] = useState<string | null>(null)
  const [childFeedback, setChildFeedback] = useState<FeedbackType>({
    rating: null,
  })
  const {
    config,
  } = useChatContext()

  const setCurrentLogItem = useAppStore(s => s.setCurrentLogItem)
  const setShowPromptLogModal = useAppStore(s => s.setShowPromptLogModal)

  const handleFeedback = async (childFeedback: FeedbackType) => {
    await updateFeedback({ url: `/messages/${childMessageId}/feedbacks`, body: { rating: childFeedback.rating } }, appSourceType, installedAppId)
    setChildFeedback(childFeedback)
  }

  const [isQuerying, { setTrue: startQuerying, setFalse: stopQuerying }] = useBoolean(false)

  const childProps: IGenerationItemProps = {
    isInWebApp,
    content: completionRes,
    messageId: childMessageId,
    depth: depth + 1,
    moreLikeThis: true,
    onFeedback: handleFeedback,
    isLoading: isQuerying,
    feedback: childFeedback,
    onSave,
    isShowTextToSpeech,
    isMobile,
    appSourceType,
    installedAppId,
    controlClearMoreLikeThis,
    isWorkflow,
    siteInfo,
    taskId,
    isError: false,
    onRetry,
  }

  const handleMoreLikeThis = async () => {
    if (isQuerying || !messageId) {
      toast.warning(t('errorMessage.waitForResponse', { ns: 'appDebug' }))
      return
    }
    startQuerying()
    const res: any = await fetchMoreLikeThis(messageId as string, appSourceType, installedAppId)
    setCompletionRes(res.answer)
    setChildFeedback({
      rating: null,
    })
    setChildMessageId(res.id)
    stopQuerying()
  }

  useEffect(() => {
    if (controlClearMoreLikeThis) {
      setChildMessageId(null)
      setCompletionRes('')
    }
  }, [controlClearMoreLikeThis])

  // regeneration clear child
  useEffect(() => {
    if (isLoading)
      setChildMessageId(null)
  }, [isLoading])

  const handleOpenLogModal = async () => {
    const data = await fetchTextGenerationMessage({
      appId: params.appId as string,
      messageId: messageId!,
    })
    const assistantFiles = data.message_files?.filter(file => file.belongs_to === 'assistant') || []
    const normalizedMessage = typeof data.message === 'string'
      ? { role: 'user', text: data.message }
      : data.message
    const baseLog = Array.isArray(normalizedMessage) ? normalizedMessage : [normalizedMessage]
    const log = Array.isArray(normalizedMessage)
      ? [
          ...normalizedMessage,
          ...(normalizedMessage.length > 0 && normalizedMessage[normalizedMessage.length - 1].role !== 'assistant'
            ? [
                {
                  role: 'assistant',
                  text: data.answer || '',
                  files: assistantFiles,
                },
              ]
            : []),
        ]
      : baseLog
    const logItem: IChatItem = {
      id: data.id || messageId || '',
      content: data.answer || '',
      isAnswer: true,
      log,
      message_files: data.message_files,
    }
    setCurrentLogItem(logItem)
    setShowPromptLogModal(true)
  }

  const [currentTab, setCurrentTab] = useState<string>('DETAIL')
  const switchTab = async (tab: string) => {
    setCurrentTab(tab)
  }
  useEffect(() => {
    if (workflowProcessData?.resultText || !!workflowProcessData?.files?.length || (workflowProcessData?.humanInputFormDataList && workflowProcessData?.humanInputFormDataList.length > 0) || (workflowProcessData?.humanInputFilledFormDataList && workflowProcessData?.humanInputFilledFormDataList.length > 0))
      switchTab('RESULT')
    else
      switchTab('DETAIL')
  }, [workflowProcessData?.files?.length, workflowProcessData?.resultText, workflowProcessData?.humanInputFormDataList, workflowProcessData?.humanInputFilledFormDataList])
  const handleSubmitHumanInputForm = useCallback(async (formToken: string, formData: { inputs: Record<string, string>, action: string }) => {
    if (appSourceType === AppSourceType.installedApp)
      await submitHumanInputFormService(formToken, formData)
    else
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

  return (
    <>
      <div className={cn('relative', !isTop && 'mt-3', className)}>
        {isLoading && (
          <div className={cn('flex h-10 items-center', !inSidePanel && 'rounded-2xl border-t border-divider-subtle bg-chat-bubble-bg')}><Loading type="area" /></div>
        )}
        {!isLoading && (
          <>
            {/* result content */}
            <div className={cn(
              'relative',
              !inSidePanel && 'rounded-2xl border-t border-divider-subtle bg-chat-bubble-bg',
            )}
            >
              {workflowProcessData && (
                <>
                  <WorkflowContent
                    content={content}
                    currentTab={currentTab}
                    hideProcessDetail={hideProcessDetail}
                    isError={isError}
                    onSubmitHumanInputForm={handleSubmitHumanInputForm}
                    onSwitchTab={switchTab}
                    siteInfo={siteInfo}
                    taskId={taskId}
                    workflowProcessData={workflowProcessData}
                  />
                </>
              )}
              {!workflowProcessData && taskId && (
                <div className={cn('sticky left-0 top-0 flex w-full items-center rounded-t-2xl bg-components-actionbar-bg p-4 pb-3 text-text-accent-secondary system-2xs-medium-uppercase', isError && 'text-text-destructive')}>
                  <RiPlayList2Line className="mr-1 h-3 w-3" />
                  <span>{t('generation.execution', { ns: 'share' })}</span>
                  <span className="px-1">·</span>
                  <span>{`${taskId}${depth > 1 ? `-${depth - 1}` : ''}`}</span>
                </div>
              )}
              {isError && (
                <div className="p-4 pt-0 text-text-quaternary body-lg-regular">{t('generation.batchFailed.outputPlaceholder', { ns: 'share' })}</div>
              )}
              {!workflowProcessData && !isError && (typeof content === 'string') && (
                <div className={cn('p-4', taskId && 'pt-0')}>
                  <Markdown content={content} />
                </div>
              )}
            </div>
            {/* meta data */}
            <div className={cn(
              'relative mt-1 h-4 px-4 text-text-quaternary system-xs-regular',
              isMobile && ((childMessageId || isQuerying) && depth < MAX_DEPTH) && 'pl-10',
            )}
            >
              {!isWorkflow && (
                <span>
                  {typeof content === 'string' ? content.length : 0}
                  {' '}
                  {t('unit.char', { ns: 'common' })}
                </span>
              )}
              {/* action buttons */}
              <div className="absolute bottom-1 right-2 flex items-center">
                <GenerationItemActionBar
                  appSourceType={appSourceType}
                  currentTab={currentTab}
                  depth={depth}
                  feedback={feedback}
                  isError={isError}
                  isInWebApp={isInWebApp}
                  isResponding={isResponding}
                  isShowTextToSpeech={isShowTextToSpeech}
                  isTryApp={isTryApp}
                  isWorkflow={isWorkflow}
                  messageId={messageId}
                  moreLikeThis={moreLikeThis}
                  onCopy={handleCopy}
                  onFeedback={onFeedback}
                  onMoreLikeThis={handleMoreLikeThis}
                  onOpenLogModal={handleOpenLogModal}
                  onRetry={onRetry}
                  onSave={onSave}
                  supportFeedback={supportFeedback}
                  voice={config?.text_to_speech?.voice}
                  workflowProcessData={workflowProcessData}
                />
              </div>
            </div>
            {/* more like this elements */}
            {!isTop && (
              <div className={cn(
                'absolute top-[-32px] flex h-[33px] w-4 justify-center',
                isMobile ? 'left-[17px]' : 'left-[50%] translate-x-[-50%]',
              )}
              >
                <div className="h-full w-0.5 bg-divider-regular"></div>
                <div className={cn(
                  'absolute left-0 flex h-4 w-4 items-center justify-center rounded-2xl border-[0.5px] border-divider-subtle bg-util-colors-blue-blue-500 shadow-xs',
                  isMobile ? 'top-[3.5px]' : 'top-2',
                )}
                >
                  <RiSparklingFill className="h-3 w-3 text-text-primary-on-surface" />
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {((childMessageId || isQuerying) && depth < MAX_DEPTH) && (
        <GenerationItem {...childProps} />
      )}
    </>
  )
}
export default React.memo(GenerationItem)
