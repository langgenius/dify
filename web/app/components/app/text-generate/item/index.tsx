'use client'
import type { FC } from 'react'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { SiteInfo } from '@/models/share'
import type { AppSourceType } from '@/service/share'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { Markdown } from '@/app/components/base/markdown'
import { cn } from '@/utils/classnames'
import GenerationItemActionBar from './action-bar'
import { useGenerationItem } from './use-generation-item'
import WorkflowContent from './workflow-content'

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
  const state = useGenerationItem({
    appSourceType,
    content,
    controlClearMoreLikeThis,
    depth,
    installedAppId,
    isInWebApp,
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
  })

  return (
    <>
      <div className={cn('relative', !state.isTop && 'mt-3', className)}>
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
                <WorkflowContent
                  content={content}
                  currentTab={state.currentTab}
                  hideProcessDetail={hideProcessDetail}
                  isError={isError}
                  onSubmitHumanInputForm={state.handleSubmitHumanInputForm}
                  onSwitchTab={state.setCurrentTab}
                  siteInfo={siteInfo}
                  taskId={taskId}
                  workflowProcessData={workflowProcessData}
                />
              )}
              {!workflowProcessData && taskId && (
                <div className={cn('sticky left-0 top-0 flex w-full items-center rounded-t-2xl bg-components-actionbar-bg p-4 pb-3 text-text-accent-secondary system-2xs-medium-uppercase', isError && 'text-text-destructive')}>
                  <span className="i-ri-play-list-2-line mr-1 h-3 w-3" aria-hidden="true" />
                  <span>{t('generation.execution', { ns: 'share' })}</span>
                  <span className="px-1">·</span>
                  <span>{state.taskLabel}</span>
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
              isMobile && state.showChildItem && 'pl-10',
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
                  currentTab={state.currentTab}
                  depth={depth}
                  feedback={feedback}
                  isError={isError}
                  isInWebApp={isInWebApp}
                  isResponding={isResponding}
                  isShowTextToSpeech={isShowTextToSpeech}
                  isTryApp={state.isTryApp}
                  isWorkflow={isWorkflow}
                  messageId={messageId}
                  moreLikeThis={moreLikeThis}
                  onCopy={state.handleCopy}
                  onFeedback={onFeedback}
                  onMoreLikeThis={state.handleMoreLikeThis}
                  onOpenLogModal={state.handleOpenLogModal}
                  onRetry={onRetry}
                  onSave={onSave}
                  supportFeedback={supportFeedback}
                  voice={state.config?.text_to_speech?.voice}
                  workflowProcessData={workflowProcessData}
                />
              </div>
            </div>
            {/* more like this elements */}
            {!state.isTop && (
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
                  <span className="i-ri-sparkling-fill h-3 w-3 text-text-primary-on-surface" aria-hidden="true" />
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {state.showChildItem && (
        <GenerationItem {...state.childProps} />
      )}
    </>
  )
}
export default React.memo(GenerationItem)
