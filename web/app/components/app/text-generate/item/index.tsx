'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiPlayList2Line,
  RiSparklingFill,
} from '@remixicon/react'
import { useParams } from 'next/navigation'
import { Markdown } from '@/app/components/base/markdown'
import Loading from '@/app/components/base/loading'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import { fetchTextGenerationMessage } from '@/service/debug'
import { useStore as useAppStore } from '@/app/components/app/store'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { SiteInfo } from '@/models/share'
import { useChatContext } from '@/app/components/base/chat/chat/context'
import cn from '@/utils/classnames'
import { MAX_DEPTH, useMoreLikeThis, useWorkflowTabs } from './hooks'
import ActionBar from './action-bar'
import WorkflowContent from './workflow-content'

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
    config,
  } = useChatContext()

  const setCurrentLogItem = useAppStore(s => s.setCurrentLogItem)
  const setShowPromptLogModal = useAppStore(s => s.setShowPromptLogModal)

  const {
    completionRes,
    childMessageId,
    childFeedback,
    isQuerying,
    handleMoreLikeThis,
    handleFeedback,
  } = useMoreLikeThis(messageId, isInstalledApp, installedAppId, controlClearMoreLikeThis, isLoading)

  const { currentTab, setCurrentTab } = useWorkflowTabs(workflowProcessData)

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

  return (
    <>
      <div className={cn('relative', !isTop && 'mt-3', className)}>
        {isLoading && (
          <div className={cn('flex h-10 items-center', !inSidePanel && 'rounded-2xl border-t border-divider-subtle bg-chat-bubble-bg')}><Loading type='area' /></div>
        )}
        {!isLoading && (
          <>
            {/* result content */}
            <div className={cn(
              'relative',
              !inSidePanel && 'rounded-2xl border-t border-divider-subtle bg-chat-bubble-bg',
            )}>
              {workflowProcessData && (
                <WorkflowContent
                  workflowProcessData={workflowProcessData}
                  taskId={taskId}
                  isError={isError}
                  hideProcessDetail={hideProcessDetail}
                  siteInfo={siteInfo}
                  currentTab={currentTab}
                  onSwitchTab={setCurrentTab}
                  content={content}
                />
              )}
              {!workflowProcessData && taskId && (
                <div className={cn('system-2xs-medium-uppercase sticky left-0 top-0 flex w-full items-center rounded-t-2xl bg-components-actionbar-bg p-4 pb-3 text-text-accent-secondary', isError && 'text-text-destructive')}>
                  <RiPlayList2Line className='mr-1 h-3 w-3' />
                  <span>{t('share.generation.execution')}</span>
                  <span className='px-1'>·</span>
                  <span>{`${taskId}${depth > 1 ? `-${depth - 1}` : ''}`}</span>
                </div>
              )}
              {isError && (
                <div className='body-lg-regular p-4 pt-0 text-text-quaternary'>{t('share.generation.batchFailed.outputPlaceholder')}</div>
              )}
              {!workflowProcessData && !isError && (typeof content === 'string') && (
                <div className={cn('p-4', taskId && 'pt-0')}>
                  <Markdown content={content} />
                </div>
              )}
            </div>

            <ActionBar
              isWorkflow={isWorkflow}
              content={content}
              isMobile={isMobile}
              hasChildItem={(!!childMessageId || isQuerying) && depth < MAX_DEPTH}
              isInWebApp={isInWebApp}
              isInstalledApp={isInstalledApp}
              isResponding={isResponding}
              isError={isError}
              messageId={messageId}
              moreLikeThis={moreLikeThis}
              depth={depth}
              onMoreLikeThis={handleMoreLikeThis}
              onOpenLog={handleOpenLogModal}
              isShowTextToSpeech={isShowTextToSpeech}
              voiceId={config?.text_to_speech?.voice}
              onRetry={onRetry}
              onSave={onSave}
              feedback={feedback}
              onFeedback={onFeedback}
              supportFeedback={supportFeedback}
              workflowProcessData={workflowProcessData}
              currentTab={currentTab}
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
      {((childMessageId || isQuerying) && depth < MAX_DEPTH) && (
        <GenerationItem {...childProps as any} />
      )}
    </>
  )
}

export default React.memo(GenerationItem)
