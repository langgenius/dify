'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiBookmark3Line,
  RiClipboardLine,
  RiFileList3Line,
  RiPlayList2Line,
  RiReplay15Line,
  RiSparklingFill,
  RiSparklingLine,
  RiThumbDownLine,
  RiThumbUpLine,
} from '@remixicon/react'
import copy from 'copy-to-clipboard'
import { useParams } from 'next/navigation'
import { useBoolean } from 'ahooks'
import ResultTab from './result-tab'
import { Markdown } from '@/app/components/base/markdown'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import { fetchMoreLikeThis, updateFeedback } from '@/service/share'
import { fetchTextGenerationMessage } from '@/service/debug'
import { useStore as useAppStore } from '@/app/components/app/store'
import WorkflowProcessItem from '@/app/components/base/chat/chat/answer/workflow-process'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { SiteInfo } from '@/models/share'
import { useChatContext } from '@/app/components/base/chat/chat/context'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import NewAudioButton from '@/app/components/base/new-audio-button'
import cn from '@/utils/classnames'

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
    await updateFeedback({ url: `/messages/${childMessageId}/feedbacks`, body: { rating: childFeedback.rating } }, isInstalledApp, installedAppId)
    setChildFeedback(childFeedback)
  }

  const [isQuerying, { setTrue: startQuerying, setFalse: stopQuerying }] = useBoolean(false)

  const childProps = {
    isInWebApp: true,
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
    isInstalledApp,
    installedAppId,
    controlClearMoreLikeThis,
    isWorkflow,
    siteInfo,
    taskId,
  }

  const handleMoreLikeThis = async () => {
    if (isQuerying || !messageId) {
      Toast.notify({ type: 'warning', message: t('appDebug.errorMessage.waitForResponse') })
      return
    }
    startQuerying()
    const res: any = await fetchMoreLikeThis(messageId as string, isInstalledApp, installedAppId)
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
    const logItem = {
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
    setCurrentLogItem(logItem)
    setShowPromptLogModal(true)
  }

  const [currentTab, setCurrentTab] = useState<string>('DETAIL')
  const showResultTabs = !!workflowProcessData?.resultText || !!workflowProcessData?.files?.length
  const switchTab = async (tab: string) => {
    setCurrentTab(tab)
  }
  useEffect(() => {
    if (workflowProcessData?.resultText || !!workflowProcessData?.files?.length)
      switchTab('RESULT')
    else
      switchTab('DETAIL')
  }, [workflowProcessData?.files?.length, workflowProcessData?.resultText])

  return (
    <>
      <div className={cn('relative', !isTop && 'mt-3', className)}>
        {isLoading && (
          <div className={cn('flex items-center h-10', !inSidePanel && 'bg-chat-bubble-bg rounded-2xl border-t border-divider-subtle')}><Loading type='area' /></div>
        )}
        {!isLoading && (
          <>
            {/* result content */}
            <div className={cn(
              'relative',
              !inSidePanel && 'bg-chat-bubble-bg rounded-2xl border-t border-divider-subtle',
            )}>
              {workflowProcessData && (
                <>
                  <div className={cn(
                    'p-3 pb-0',
                    showResultTabs && 'border-b border-divider-subtle',
                  )}>
                    {taskId && (
                      <div className={cn('mb-2 flex items-center system-2xs-medium-uppercase text-text-accent-secondary', isError && 'text-text-destructive')}>
                        <RiPlayList2Line className='w-3 h-3 mr-1' />
                        <span>{t('share.generation.execution')}</span>
                        <span className='px-1'>·</span>
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
                      <div className='flex items-center px-1 space-x-6'>
                        <div
                          className={cn(
                            'py-3 border-b-2 border-transparent system-sm-semibold-uppercase text-text-tertiary cursor-pointer',
                            currentTab === 'RESULT' && 'text-text-primary border-util-colors-blue-brand-blue-brand-600',
                          )}
                          onClick={() => switchTab('RESULT')}
                        >{t('runLog.result')}</div>
                        <div
                          className={cn(
                            'py-3 border-b-2 border-transparent system-sm-semibold-uppercase text-text-tertiary cursor-pointer',
                            currentTab === 'DETAIL' && 'text-text-primary border-util-colors-blue-brand-blue-brand-600',
                          )}
                          onClick={() => switchTab('DETAIL')}
                        >{t('runLog.detail')}</div>
                      </div>
                    )}
                  </div>
                  {!isError && (
                    <ResultTab data={workflowProcessData} content={content} currentTab={currentTab} />
                  )}
                </>
              )}
              {!workflowProcessData && taskId && (
                <div className={cn('sticky left-0 top-0 flex items-center w-full p-4 pb-3 bg-components-actionbar-bg rounded-t-2xl system-2xs-medium-uppercase text-text-accent-secondary', isError && 'text-text-destructive')}>
                  <RiPlayList2Line className='w-3 h-3 mr-1' />
                  <span>{t('share.generation.execution')}</span>
                  <span className='px-1'>·</span>
                  <span>{`${taskId}${depth > 1 ? `-${depth - 1}` : ''}`}</span>
                </div>
              )}
              {isError && (
                <div className='p-4 pt-0 text-text-quaternary body-lg-regular'>{t('share.generation.batchFailed.outputPlaceholder')}</div>
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
              isMobile && ((childMessageId || isQuerying) && depth < 3) && 'pl-10',
            )}>
              {!isWorkflow && <span>{content?.length} {t('common.unit.char')}</span>}
              {/* action buttons */}
              <div className='absolute right-2 bottom-1 flex items-center'>
                {!isInWebApp && !isInstalledApp && !isResponding && (
                  <div className='ml-1 flex items-center gap-0.5 p-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg shadow-md backdrop-blur-sm'>
                    <ActionButton disabled={isError || !messageId} onClick={handleOpenLogModal}>
                      <RiFileList3Line className='w-4 h-4' />
                      {/* <div>{t('common.operation.log')}</div> */}
                    </ActionButton>
                  </div>
                )}
                <div className='ml-1 flex items-center gap-0.5 p-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg shadow-md backdrop-blur-sm'>
                  {moreLikeThis && (
                    <ActionButton state={depth === MAX_DEPTH ? ActionButtonState.Disabled : ActionButtonState.Default} disabled={depth === MAX_DEPTH} onClick={handleMoreLikeThis}>
                      <RiSparklingLine className='w-4 h-4' />
                    </ActionButton>
                  )}
                  {isShowTextToSpeech && (
                    <NewAudioButton
                      id={messageId!}
                      voice={config?.text_to_speech?.voice}
                    />
                  )}
                  {((currentTab === 'RESULT' && workflowProcessData?.resultText) || !isWorkflow) && (
                    <ActionButton disabled={isError || !messageId} onClick={() => {
                      const copyContent = isWorkflow ? workflowProcessData?.resultText : content
                      if (typeof copyContent === 'string')
                        copy(copyContent)
                      else
                        copy(JSON.stringify(copyContent))
                      Toast.notify({ type: 'success', message: t('common.actionMsg.copySuccessfully') })
                    }}>
                      <RiClipboardLine className='w-4 h-4' />
                    </ActionButton>
                  )}
                  {isInWebApp && isError && (
                    <ActionButton onClick={onRetry}>
                      <RiReplay15Line className='w-4 h-4' />
                    </ActionButton>
                  )}
                  {isInWebApp && !isWorkflow && (
                    <ActionButton disabled={isError || !messageId} onClick={() => { onSave?.(messageId as string) }}>
                      <RiBookmark3Line className='w-4 h-4' />
                    </ActionButton>
                  )}
                </div>
                {(supportFeedback || isInWebApp) && !isWorkflow && !isError && messageId && (
                  <div className='ml-1 flex items-center gap-0.5 p-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg shadow-md backdrop-blur-sm'>
                    {!feedback?.rating && (
                      <>
                        <ActionButton onClick={() => onFeedback?.({ rating: 'like' })}>
                          <RiThumbUpLine className='w-4 h-4' />
                        </ActionButton>
                        <ActionButton onClick={() => onFeedback?.({ rating: 'dislike' })}>
                          <RiThumbDownLine className='w-4 h-4' />
                        </ActionButton>
                      </>
                    )}
                    {feedback?.rating === 'like' && (
                      <ActionButton state={ActionButtonState.Active} onClick={() => onFeedback?.({ rating: null })}>
                        <RiThumbUpLine className='w-4 h-4' />
                      </ActionButton>
                    )}
                    {feedback?.rating === 'dislike' && (
                      <ActionButton state={ActionButtonState.Destructive} onClick={() => onFeedback?.({ rating: null })}>
                        <RiThumbDownLine className='w-4 h-4' />
                      </ActionButton>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* more like this elements */}
            {!isTop && (
              <div className={cn(
                'absolute top-[-32px] w-4 h-[33px] flex justify-center',
                isMobile ? 'left-[17px]' : 'left-[50%] translate-x-[-50%]',
              )}>
                <div className='h-full w-0.5 bg-divider-regular'></div>
                <div className={cn(
                  'absolute left-0 w-4 h-4 flex items-center justify-center bg-util-colors-blue-blue-500 rounded-2xl border-[0.5px] border-divider-subtle shadow-xs',
                  isMobile ? 'top-[3.5px]' : 'top-2',
                )}>
                  <RiSparklingFill className='w-3 h-3 text-text-primary-on-surface' />
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
