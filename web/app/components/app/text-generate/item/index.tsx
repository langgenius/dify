'use client'
import type { FC } from 'react'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { SiteInfo } from '@/models/share'
import {
  RiBookmark3Line,
  RiClipboardLine,
  RiFileList3Line,
  RiPlayList2Line,
  RiResetLeftLine,
  RiSparklingFill,
  RiSparklingLine,
  RiThumbDownLine,
  RiThumbUpLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import HumanInputFilledFormList from '@/app/components/base/chat/chat/answer/human-input-filled-form-list'
import HumanInputFormList from '@/app/components/base/chat/chat/answer/human-input-form-list'
import WorkflowProcessItem from '@/app/components/base/chat/chat/answer/workflow-process'
import { useChatContext } from '@/app/components/base/chat/chat/context'
import Loading from '@/app/components/base/loading'
import { Markdown } from '@/app/components/base/markdown'
import NewAudioButton from '@/app/components/base/new-audio-button'
import { toast } from '@/app/components/base/ui/toast'
import { useParams } from '@/next/navigation'
import { fetchTextGenerationMessage } from '@/service/debug'
import { AppSourceType, fetchMoreLikeThis, submitHumanInputForm, updateFeedback } from '@/service/share'
import { submitHumanInputForm as submitHumanInputFormService } from '@/service/workflow'
import { cn } from '@/utils/classnames'
import ResultTab from './result-tab'

const MAX_DEPTH = 3

type IGenerationItemProps = {
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

  const childProps = {
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
    const logItem = Array.isArray(data.message)
      ? {
          ...data,
          log: [
            ...data.message,
            ...(data.message[data.message.length - 1].role !== 'assistant'
              ? [
                  {
                    role: 'assistant',
                    text: data.answer,
                    files: data.message_files?.filter((file: any) => file.belongs_to === 'assistant') || [],
                  },
                ]
              : []),
          ],
        }
      : {
          ...data,
          log: [typeof data.message === 'string'
            ? {
                text: data.message,
              }
            : data.message],
        }
    setCurrentLogItem(logItem)
    setShowPromptLogModal(true)
  }

  const [currentTab, setCurrentTab] = useState<string>('DETAIL')
  const showResultTabs = !!workflowProcessData?.resultText || !!workflowProcessData?.files?.length || (workflowProcessData?.humanInputFormDataList && workflowProcessData?.humanInputFormDataList.length > 0) || (workflowProcessData?.humanInputFilledFormDataList && workflowProcessData?.humanInputFilledFormDataList.length > 0)
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
                  <div className={cn(
                    'p-3',
                    showResultTabs && 'border-b border-divider-subtle',
                  )}
                  >
                    {taskId && (
                      <div className={cn('system-2xs-medium-uppercase mb-2 flex items-center text-text-accent-secondary', isError && 'text-text-destructive')}>
                        <RiPlayList2Line className="mr-1 h-3 w-3" />
                        <span>{t('generation.execution', { ns: 'share' })}</span>
                        <span className="px-1">·</span>
                        <span>{taskId}</span>
                      </div>
                    )}
                    {siteInfo && workflowProcessData && (
                      <WorkflowProcessItem
                        data={workflowProcessData}
                        expand={workflowProcessData.expand}
                        hideProcessDetail={hideProcessDetail}
                        hideInfo={hideProcessDetail}
                        readonly={!siteInfo.show_workflow_steps}
                      />
                    )}
                    {showResultTabs && (
                      <div className="flex items-center space-x-6 px-1">
                        <div
                          className={cn(
                            'system-sm-semibold-uppercase cursor-pointer border-b-2 border-transparent py-3 text-text-tertiary',
                            currentTab === 'RESULT' && 'border-util-colors-blue-brand-blue-brand-600 text-text-primary',
                          )}
                          onClick={() => switchTab('RESULT')}
                        >
                          {t('result', { ns: 'runLog' })}
                        </div>
                        <div
                          className={cn(
                            'system-sm-semibold-uppercase cursor-pointer border-b-2 border-transparent py-3 text-text-tertiary',
                            currentTab === 'DETAIL' && 'border-util-colors-blue-brand-blue-brand-600 text-text-primary',
                          )}
                          onClick={() => switchTab('DETAIL')}
                        >
                          {t('detail', { ns: 'runLog' })}
                        </div>
                      </div>
                    )}
                  </div>
                  {!isError && (
                    <>
                      {currentTab === 'RESULT' && workflowProcessData.humanInputFormDataList && workflowProcessData.humanInputFormDataList.length > 0 && (
                        <div className="px-4 pt-4">
                          <HumanInputFormList
                            humanInputFormDataList={workflowProcessData.humanInputFormDataList}
                            onHumanInputFormSubmit={handleSubmitHumanInputForm}
                          />
                        </div>
                      )}
                      {currentTab === 'RESULT' && workflowProcessData.humanInputFilledFormDataList && workflowProcessData.humanInputFilledFormDataList.length > 0 && (
                        <div className="px-4 pt-4">
                          <HumanInputFilledFormList
                            humanInputFilledFormDataList={workflowProcessData.humanInputFilledFormDataList}
                          />
                        </div>
                      )}
                      <ResultTab data={workflowProcessData} content={content} currentTab={currentTab} />
                    </>
                  )}
                </>
              )}
              {!workflowProcessData && taskId && (
                <div className={cn('system-2xs-medium-uppercase sticky left-0 top-0 flex w-full items-center rounded-t-2xl bg-components-actionbar-bg p-4 pb-3 text-text-accent-secondary', isError && 'text-text-destructive')}>
                  <RiPlayList2Line className="mr-1 h-3 w-3" />
                  <span>{t('generation.execution', { ns: 'share' })}</span>
                  <span className="px-1">·</span>
                  <span>{`${taskId}${depth > 1 ? `-${depth - 1}` : ''}`}</span>
                </div>
              )}
              {isError && (
                <div className="body-lg-regular p-4 pt-0 text-text-quaternary">{t('generation.batchFailed.outputPlaceholder', { ns: 'share' })}</div>
              )}
              {!workflowProcessData && !isError && (typeof content === 'string') && (
                <div className={cn('p-4', taskId && 'pt-0')}>
                  <Markdown content={content} />
                </div>
              )}
            </div>
            {/* meta data */}
            <div className={cn(
              'system-xs-regular relative mt-1 h-4 px-4 text-text-quaternary',
              isMobile && ((childMessageId || isQuerying) && depth < 3) && 'pl-10',
            )}
            >
              {!isWorkflow && (
                <span>
                  {content?.length}
                  {' '}
                  {t('unit.char', { ns: 'common' })}
                </span>
              )}
              {/* action buttons */}
              <div className="absolute bottom-1 right-2 flex items-center">
                {!isInWebApp && (appSourceType !== AppSourceType.installedApp) && !isResponding && (
                  <div className="ml-1 flex items-center gap-0.5 radius-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs">
                    <ActionButton disabled={isError || !messageId} onClick={handleOpenLogModal}>
                      <RiFileList3Line className="h-4 w-4" />
                      {/* <div>{t('common.operation.log')}</div> */}
                    </ActionButton>
                  </div>
                )}
                <div className="ml-1 flex items-center gap-0.5 radius-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs">
                  {moreLikeThis && !isTryApp && (
                    <ActionButton state={depth === MAX_DEPTH ? ActionButtonState.Disabled : ActionButtonState.Default} disabled={depth === MAX_DEPTH} onClick={handleMoreLikeThis}>
                      <RiSparklingLine className="h-4 w-4" />
                    </ActionButton>
                  )}
                  {isShowTextToSpeech && !isTryApp && (
                    <NewAudioButton
                      id={messageId!}
                      voice={config?.text_to_speech?.voice}
                    />
                  )}
                  {((currentTab === 'RESULT' && workflowProcessData?.resultText) || !isWorkflow) && (
                    <ActionButton
                      disabled={isError || !messageId}
                      onClick={() => {
                        const copyContent = isWorkflow ? workflowProcessData?.resultText : content
                        if (typeof copyContent === 'string')
                          copy(copyContent)
                        else
                          copy(JSON.stringify(copyContent))
                        toast.success(t('actionMsg.copySuccessfully', { ns: 'common' }))
                      }}
                    >
                      <RiClipboardLine className="h-4 w-4" />
                    </ActionButton>
                  )}
                  {isInWebApp && isError && (
                    <ActionButton onClick={onRetry}>
                      <RiResetLeftLine className="h-4 w-4" />
                    </ActionButton>
                  )}
                  {isInWebApp && !isWorkflow && !isTryApp && (
                    <ActionButton disabled={isError || !messageId} onClick={() => { onSave?.(messageId as string) }}>
                      <RiBookmark3Line className="h-4 w-4" />
                    </ActionButton>
                  )}
                </div>
                {(supportFeedback || isInWebApp) && !isWorkflow && !isTryApp && !isError && messageId && (
                  <div className="ml-1 flex items-center gap-0.5 radius-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs">
                    {!feedback?.rating && (
                      <>
                        <ActionButton onClick={() => onFeedback?.({ rating: 'like' })}>
                          <RiThumbUpLine className="h-4 w-4" />
                        </ActionButton>
                        <ActionButton onClick={() => onFeedback?.({ rating: 'dislike' })}>
                          <RiThumbDownLine className="h-4 w-4" />
                        </ActionButton>
                      </>
                    )}
                    {feedback?.rating === 'like' && (
                      <ActionButton state={ActionButtonState.Active} onClick={() => onFeedback?.({ rating: null })}>
                        <RiThumbUpLine className="h-4 w-4" />
                      </ActionButton>
                    )}
                    {feedback?.rating === 'dislike' && (
                      <ActionButton state={ActionButtonState.Destructive} onClick={() => onFeedback?.({ rating: null })}>
                        <RiThumbDownLine className="h-4 w-4" />
                      </ActionButton>
                    )}
                  </div>
                )}
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
      {((childMessageId || isQuerying) && depth < 3) && (
        <GenerationItem {...childProps as any} />
      )}
    </>
  )
}
export default React.memo(GenerationItem)
