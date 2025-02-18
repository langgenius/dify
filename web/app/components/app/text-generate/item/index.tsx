'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiClipboardLine,
} from '@remixicon/react'
import copy from 'copy-to-clipboard'
import { useParams } from 'next/navigation'
import { HandThumbDownIcon, HandThumbUpIcon } from '@heroicons/react/24/outline'
import { useBoolean } from 'ahooks'
import { HashtagIcon } from '@heroicons/react/24/solid'
import ResultTab from './result-tab'
import cn from '@/utils/classnames'
import { Markdown } from '@/app/components/base/markdown'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import AudioBtn from '@/app/components/base/audio-btn'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import { fetchMoreLikeThis, updateFeedback } from '@/service/share'
import { File02 } from '@/app/components/base/icons/src/vender/line/files'
import { Bookmark } from '@/app/components/base/icons/src/vender/line/general'
import { Stars02 } from '@/app/components/base/icons/src/vender/line/weather'
import { RefreshCcw01 } from '@/app/components/base/icons/src/vender/line/arrows'
import AnnotationCtrlBtn from '@/app/components/base/features/new-feature-panel/annotation-reply/annotation-ctrl-btn'
import { fetchTextGenerationMessage } from '@/service/debug'
import EditReplyModal from '@/app/components/app/annotation/edit-annotation-modal'
import { useStore as useAppStore } from '@/app/components/app/store'
import WorkflowProcessItem from '@/app/components/base/chat/chat/answer/workflow-process'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { SiteInfo } from '@/models/share'
import { useChatContext } from '@/app/components/base/chat/chat/context'

const MAX_DEPTH = 3

export interface IGenerationItemProps {
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
  supportAnnotation?: boolean
  isShowTextToSpeech?: boolean
  appId?: string
  varList?: { label: string; value: string | number | object }[]
  innerClassName?: string
  contentClassName?: string
  footerClassName?: string
  hideProcessDetail?: boolean
  siteInfo: SiteInfo | null
}

export const SimpleBtn = ({ className, isDisabled, onClick, children }: {
  className?: string
  isDisabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}) => (
  <div
    className={cn(isDisabled ? 'border-gray-100 text-gray-300' : 'cursor-pointer border-gray-200 text-gray-700 hover:border-gray-300 hover:shadow-sm', 'flex h-7 items-center rounded-md border px-3 text-xs  font-medium', className)}
    onClick={() => !isDisabled && onClick?.()}
  >
    {children}
  </div>
)

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
  supportAnnotation,
  isShowTextToSpeech,
  appId,
  varList,
  innerClassName,
  contentClassName,
  hideProcessDetail,
  siteInfo,
}) => {
  const { t } = useTranslation()
  const params = useParams()
  const isTop = depth === 1
  const ref = useRef(null)
  const [completionRes, setCompletionRes] = useState('')
  const [childMessageId, setChildMessageId] = useState<string | null>(null)
  const hasChild = !!childMessageId
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

  const [isShowReplyModal, setIsShowReplyModal] = useState(false)
  const question = (varList && varList?.length > 0) ? varList?.map(({ label, value }) => `${label}:${value}`).join('&') : ''
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

  const mainStyle = (() => {
    const res: React.CSSProperties = !isTop
      ? {
        background: depth % 2 === 0 ? 'linear-gradient(90.07deg, #F9FAFB 0.05%, rgba(249, 250, 251, 0) 99.93%)' : '#fff',
      }
      : {}

    if (hasChild)
      res.boxShadow = '0px 1px 2px rgba(16, 24, 40, 0.05)'

    return res
  })()

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

  const ratingContent = (
    <>
      {!isWorkflow && !isError && messageId && !feedback?.rating && (
        <SimpleBtn className="!px-0">
          <>
            <div
              onClick={() => {
                onFeedback?.({
                  rating: 'like',
                })
              }}
              className='flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-gray-100'>
              <HandThumbUpIcon width={16} height={16} />
            </div>
            <div
              onClick={() => {
                onFeedback?.({
                  rating: 'dislike',
                })
              }}
              className='flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-gray-100'>
              <HandThumbDownIcon width={16} height={16} />
            </div>
          </>
        </SimpleBtn>
      )}
      {!isWorkflow && !isError && messageId && feedback?.rating === 'like' && (
        <div
          onClick={() => {
            onFeedback?.({
              rating: null,
            })
          }}
          className='!text-primary-600 border-primary-200 bg-primary-100 hover:border-primary-300 hover:bg-primary-200 flex h-7  w-7 cursor-pointer items-center justify-center rounded-md border'>
          <HandThumbUpIcon width={16} height={16} />
        </div>
      )}
      {!isWorkflow && !isError && messageId && feedback?.rating === 'dislike' && (
        <div
          onClick={() => {
            onFeedback?.({
              rating: null,
            })
          }}
          className='flex h-7 w-7 cursor-pointer items-center justify-center rounded-md  border border-red-200 bg-red-100 !text-red-600 hover:border-red-300 hover:bg-red-200'>
          <HandThumbDownIcon width={16} height={16} />
        </div>
      )}
    </>
  )

  const [currentTab, setCurrentTab] = useState<string>('DETAIL')

  return (
    <div ref={ref} className={cn(isTop ? `rounded-xl border ${!isError ? 'bg-chat-bubble-bg border-gray-200' : 'border-[#FECDCA] bg-[#FEF3F2]'} ` : '!mt-0 rounded-br-xl', className)}
      style={isTop
        ? {
          boxShadow: '0px 1px 2px rgba(16, 24, 40, 0.05)',
        }
        : {}}
    >
      {isLoading
        ? (
          <div className='flex h-10 items-center'><Loading type='area' /></div>
        )
        : (
          <div
            className={cn(!isTop && 'border-primary-400 rounded-br-xl border-l-2', 'p-4', innerClassName)}
            style={mainStyle}
          >
            {(isTop && taskId) && (
              <div className='mb-2 box-border flex w-fit items-center rounded-md border border-gray-200 pl-1 pr-1.5 text-[11px] font-medium italic text-gray-500 group-hover:opacity-100'>
                <HashtagIcon className='mr-1 h-3 w-3 fill-current stroke-current stroke-1 text-gray-400' />
                {taskId}
              </div>)
            }
            <div className={`flex ${contentClassName}`}>
              <div className='w-0 grow'>
                {siteInfo && workflowProcessData && (
                  <WorkflowProcessItem
                    data={workflowProcessData}
                    expand={workflowProcessData.expand}
                    hideProcessDetail={hideProcessDetail}
                    hideInfo={hideProcessDetail}
                    readonly={!siteInfo.show_workflow_steps}
                  />
                )}
                {workflowProcessData && !isError && (
                  <ResultTab data={workflowProcessData} content={content} currentTab={currentTab} onCurrentTabChange={setCurrentTab} />
                )}
                {isError && (
                  <div className='text-sm text-gray-400'>{t('share.generation.batchFailed.outputPlaceholder')}</div>
                )}
                {!workflowProcessData && !isError && (typeof content === 'string') && (
                  <Markdown content={content} />
                )}
              </div>
            </div>

            <div className='mt-3 flex items-center justify-between'>
              <div className='flex items-center'>
                {
                  !isInWebApp && !isInstalledApp && !isResponding && (
                    <SimpleBtn
                      isDisabled={isError || !messageId}
                      className={cn(isMobile && '!px-1.5', 'mr-1 space-x-1')}
                      onClick={handleOpenLogModal}>
                      <File02 className='h-3.5 w-3.5' />
                      {!isMobile && <div>{t('common.operation.log')}</div>}
                    </SimpleBtn>
                  )
                }
                {((currentTab === 'RESULT' && workflowProcessData?.resultText) || !isWorkflow) && (
                  <SimpleBtn
                    isDisabled={isError || !messageId}
                    className={cn(isMobile && '!px-1.5', 'space-x-1')}
                    onClick={() => {
                      const copyContent = isWorkflow ? workflowProcessData?.resultText : content
                      if (typeof copyContent === 'string')
                        copy(copyContent)
                      else
                        copy(JSON.stringify(copyContent))
                      Toast.notify({ type: 'success', message: t('common.actionMsg.copySuccessfully') })
                    }}>
                    <RiClipboardLine className='h-3.5 w-3.5' />
                    {!isMobile && <div>{t('common.operation.copy')}</div>}
                  </SimpleBtn>
                )}

                {isInWebApp && (
                  <>
                    {!isWorkflow && (
                      <SimpleBtn
                        isDisabled={isError || !messageId}
                        className={cn(isMobile && '!px-1.5', 'ml-2 space-x-1')}
                        onClick={() => { onSave?.(messageId as string) }}
                      >
                        <Bookmark className='h-3.5 w-3.5' />
                        {!isMobile && <div>{t('common.operation.save')}</div>}
                      </SimpleBtn>
                    )}
                    {(moreLikeThis && depth < MAX_DEPTH) && (
                      <SimpleBtn
                        isDisabled={isError || !messageId}
                        className={cn(isMobile && '!px-1.5', 'ml-2 space-x-1')}
                        onClick={handleMoreLikeThis}
                      >
                        <Stars02 className='h-3.5 w-3.5' />
                        {!isMobile && <div>{t('appDebug.feature.moreLikeThis.title')}</div>}
                      </SimpleBtn>
                    )}
                    {isError && (
                      <SimpleBtn
                        onClick={onRetry}
                        className={cn(isMobile && '!px-1.5', 'ml-2 space-x-1')}
                      >
                        <RefreshCcw01 className='h-3.5 w-3.5' />
                        {!isMobile && <div>{t('share.generation.batchFailed.retry')}</div>}
                      </SimpleBtn>
                    )}
                    {!isError && messageId && !isWorkflow && (
                      <div className="mx-3 h-[14px] w-[1px] bg-gray-200"></div>
                    )}
                    {ratingContent}
                  </>
                )}

                {supportAnnotation && (
                  <>
                    <div className='ml-2 mr-1 h-[14px] w-[1px] bg-gray-200'></div>
                    <AnnotationCtrlBtn
                      appId={appId!}
                      messageId={messageId!}
                      className='ml-1'
                      query={question}
                      answer={content}
                      // not support cache. So can not be cached
                      cached={false}
                      onAdded={() => {

                      }}
                      onEdit={() => setIsShowReplyModal(true)}
                      onRemoved={() => { }}
                    />
                  </>
                )}

                <EditReplyModal
                  appId={appId!}
                  messageId={messageId!}
                  isShow={isShowReplyModal}
                  onHide={() => setIsShowReplyModal(false)}
                  query={question}
                  answer={content}
                  onAdded={() => { }}
                  onEdited={() => { }}
                  createdAt={0}
                  onRemove={() => { }}
                  onlyEditResponse
                />

                {supportFeedback && (
                  <div className='ml-1'>
                    {ratingContent}
                  </div>
                )}

                {isShowTextToSpeech && (
                  <>
                    <div className='ml-2 mr-2 h-[14px] w-[1px] bg-gray-200'></div>
                    <AudioBtn
                      id={messageId!}
                      className={'mr-1'}
                      voice={config?.text_to_speech?.voice}
                    />
                  </>
                )}
              </div>
              <div>
                {!workflowProcessData && (
                  <div className='text-xs text-gray-500'>{content?.length} {t('common.unit.char')}</div>
                )}
              </div>
            </div>

          </div>
        )}

      {((childMessageId || isQuerying) && depth < 3) && (
        <div className='pl-4'>
          <GenerationItem {...childProps as any} />
        </div>
      )}

    </div>
  )
}
export default React.memo(GenerationItem)
