'use client'
import type { FC } from 'react'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { SiteInfo } from '@/models/share'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiPlayList2Line,
  RiSparklingFill,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
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
import GenerationActionGroups from './action-groups'
import {
  buildPromptLogItem,
  getDefaultGenerationTab,
  getGenerationTaskLabel,
  MAX_GENERATION_DEPTH,
  shouldShowWorkflowResultTabs,
} from './utils'
import WorkflowBody from './workflow-body'

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
      // eslint-disable-next-line react/set-state-in-effect
      setChildMessageId(null)
      // eslint-disable-next-line react/set-state-in-effect
      setCompletionRes('')
    }
  }, [controlClearMoreLikeThis])

  // regeneration clear child
  useEffect(() => {
    if (isLoading)
      // eslint-disable-next-line react/set-state-in-effect
      setChildMessageId(null)
  }, [isLoading])

  const handleOpenLogModal = async () => {
    const data = await fetchTextGenerationMessage({
      appId: params.appId as string,
      messageId: messageId!,
    })
    setCurrentLogItem(buildPromptLogItem(data))
    setShowPromptLogModal(true)
  }

  const [currentTab, setCurrentTab] = useState<string>('DETAIL')
  const showResultTabs = shouldShowWorkflowResultTabs(workflowProcessData)
  const switchTab = async (tab: string) => {
    setCurrentTab(tab)
  }
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setCurrentTab(getDefaultGenerationTab(workflowProcessData))
  }, [workflowProcessData])
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
              <WorkflowBody
                content={content}
                currentTab={currentTab}
                depth={depth}
                hideProcessDetail={hideProcessDetail}
                isError={isError}
                onSubmitHumanInputForm={handleSubmitHumanInputForm}
                onSwitchTab={switchTab}
                showResultTabs={showResultTabs}
                siteInfo={siteInfo}
                taskId={taskId}
                workflowProcessData={workflowProcessData}
              />
              {!workflowProcessData && taskId && (
                <div className={cn('sticky top-0 left-0 flex w-full items-center rounded-t-2xl bg-components-actionbar-bg p-4 pb-3 system-2xs-medium-uppercase text-text-accent-secondary', isError && 'text-text-destructive')}>
                  <RiPlayList2Line className="mr-1 h-3 w-3" />
                  <span>{t('generation.execution', { ns: 'share' })}</span>
                  <span className="px-1">·</span>
                  <span>{getGenerationTaskLabel(taskId, depth)}</span>
                </div>
              )}
              {isError && (
                <div className="p-4 pt-0 body-lg-regular text-text-quaternary">{t('generation.batchFailed.outputPlaceholder', { ns: 'share' })}</div>
              )}
              {!workflowProcessData && !isError && (typeof content === 'string') && (
                <div className={cn('p-4', taskId && 'pt-0')}>
                  <Markdown content={content} />
                </div>
              )}
            </div>
            {/* meta data */}
            <div className={cn(
              'relative mt-1 h-4 px-4 system-xs-regular text-text-quaternary',
              isMobile && ((childMessageId || isQuerying) && depth < MAX_GENERATION_DEPTH) && 'pl-10',
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
              <div className="absolute right-2 bottom-1 flex items-center">
                <GenerationActionGroups
                  appSourceType={appSourceType}
                  content={content}
                  currentTab={currentTab}
                  depth={depth}
                  feedback={feedback}
                  isError={isError}
                  isInWebApp={isInWebApp}
                  isResponding={isResponding}
                  isShowTextToSpeech={isShowTextToSpeech}
                  isWorkflow={isWorkflow}
                  messageId={messageId}
                  moreLikeThis={moreLikeThis}
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
      {((childMessageId || isQuerying) && depth < MAX_GENERATION_DEPTH) && (
        <GenerationItem {...childProps as any} />
      )}
    </>
  )
}
export default React.memo(GenerationItem)
