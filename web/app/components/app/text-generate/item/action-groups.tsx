'use client'
import type { FC } from 'react'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { AppSourceType } from '@/service/share'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { toast } from '@langgenius/dify-ui/toast'
import { Toggle } from '@langgenius/dify-ui/toggle'
import copy from 'copy-to-clipboard'
import { useTranslation } from 'react-i18next'
import NewAudioButton from '@/app/components/base/new-audio-button'
import { AppSourceType as AppSourceTypeEnum } from '@/service/share'
import { getCopyContent, MAX_GENERATION_DEPTH } from './utils'

const accentPressedClassName =
  'data-pressed:bg-state-accent-active data-pressed:text-text-accent data-pressed:hover:bg-state-accent-active-alt'
const destructivePressedClassName =
  'data-pressed:bg-state-destructive-hover data-pressed:text-text-destructive data-pressed:hover:bg-state-destructive-hover data-pressed:hover:text-text-destructive'

type GenerationActionGroupsProps = {
  appSourceType: AppSourceType
  content: unknown
  currentTab: string
  depth: number
  feedback?: FeedbackType
  hideLogAction?: boolean
  isError: boolean
  isInWebApp: boolean
  isResponding?: boolean
  isShowTextToSpeech?: boolean
  isWorkflow?: boolean
  messageId?: string | null
  moreLikeThis?: boolean
  onFeedback?: (feedback: FeedbackType) => void
  onMoreLikeThis: () => void
  onOpenLogModal: () => void
  onRetry: () => void
  onSave?: (messageId: string) => void
  supportFeedback?: boolean
  voice?: string
  workflowProcessData?: WorkflowProcess
}

const GenerationActionGroups: FC<GenerationActionGroupsProps> = ({
  appSourceType,
  content,
  currentTab,
  depth,
  feedback,
  hideLogAction,
  isError,
  isInWebApp,
  isResponding,
  isShowTextToSpeech,
  isWorkflow,
  messageId,
  moreLikeThis,
  onFeedback,
  onMoreLikeThis,
  onOpenLogModal,
  onRetry,
  onSave,
  supportFeedback,
  voice,
  workflowProcessData,
}) => {
  const { t } = useTranslation()
  const isTryApp = appSourceType === AppSourceTypeEnum.tryApp
  const showCopyAction = (currentTab === 'RESULT' && workflowProcessData?.resultText) || !isWorkflow

  return (
    <>
      {!hideLogAction &&
        !isInWebApp &&
        appSourceType !== AppSourceTypeEnum.installedApp &&
        !isResponding && (
          <div className="ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs">
            <IconButton
              aria-label={t(($) => $['operation.log'], { ns: 'common' })}
              disabled={isError || !messageId}
              title={t(($) => $['operation.log'], { ns: 'common' })}
              onClick={onOpenLogModal}
            >
              <span aria-hidden="true" className="i-ri-file-list-3-line size-4" />
            </IconButton>
          </div>
        )}
      <div className="ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs">
        {moreLikeThis && !isTryApp && (
          <IconButton
            aria-label={t(($) => $['feature.moreLikeThis.title'], { ns: 'appDebug' })}
            disabled={depth === MAX_GENERATION_DEPTH}
            title={t(($) => $['feature.moreLikeThis.title'], { ns: 'appDebug' })}
            onClick={onMoreLikeThis}
          >
            <span aria-hidden="true" className="i-ri-sparkling-line size-4" />
          </IconButton>
        )}
        {isShowTextToSpeech && !isTryApp && <NewAudioButton id={messageId!} voice={voice} />}
        {showCopyAction && (
          <IconButton
            aria-label={t(($) => $['operation.copy'], { ns: 'common' })}
            disabled={isError || !messageId}
            title={t(($) => $['operation.copy'], { ns: 'common' })}
            onClick={() => {
              const copyContent = getCopyContent({ content, isWorkflow, workflowProcessData })
              if (typeof copyContent === 'string') copy(copyContent)
              else copy(JSON.stringify(copyContent))
              toast.success(t(($) => $['actionMsg.copySuccessfully'], { ns: 'common' }))
            }}
          >
            <span aria-hidden="true" className="i-ri-clipboard-line size-4" />
          </IconButton>
        )}
        {isInWebApp && isError && (
          <IconButton
            aria-label={t(($) => $['generation.batchFailed.retry'], { ns: 'share' })}
            title={t(($) => $['generation.batchFailed.retry'], { ns: 'share' })}
            onClick={onRetry}
          >
            <span aria-hidden="true" className="i-ri-reset-left-line size-4" />
          </IconButton>
        )}
        {isInWebApp && !isWorkflow && !isTryApp && (
          <IconButton
            aria-label={t(($) => $['operation.save'], { ns: 'common' })}
            disabled={isError || !messageId}
            title={t(($) => $['operation.save'], { ns: 'common' })}
            onClick={() => {
              onSave?.(messageId as string)
            }}
          >
            <span aria-hidden="true" className="i-ri-bookmark-3-line size-4" />
          </IconButton>
        )}
      </div>
      {(supportFeedback || isInWebApp) && !isWorkflow && !isTryApp && !isError && messageId && (
        <div className="ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs">
          {!feedback?.rating && (
            <>
              <Toggle
                className={accentPressedClassName}
                pressed={false}
                onPressedChange={(pressed) => pressed && onFeedback?.({ rating: 'like' })}
                render={
                  <IconButton
                    aria-label={t(($) => $['operation.agree'], { ns: 'appDebug' })}
                    title={t(($) => $['operation.agree'], { ns: 'appDebug' })}
                  >
                    <span aria-hidden="true" className="i-ri-thumb-up-line size-4" />
                  </IconButton>
                }
              />
              <Toggle
                className={destructivePressedClassName}
                pressed={false}
                onPressedChange={(pressed) => pressed && onFeedback?.({ rating: 'dislike' })}
                render={
                  <IconButton
                    aria-label={t(($) => $['operation.disagree'], { ns: 'appDebug' })}
                    title={t(($) => $['operation.disagree'], { ns: 'appDebug' })}
                  >
                    <span aria-hidden="true" className="i-ri-thumb-down-line size-4" />
                  </IconButton>
                }
              />
            </>
          )}
          {feedback?.rating === 'like' && (
            <Toggle
              className={accentPressedClassName}
              pressed
              onPressedChange={(pressed) => !pressed && onFeedback?.({ rating: null })}
              render={
                <IconButton
                  aria-label={t(($) => $['operation.agree'], { ns: 'appDebug' })}
                  title={t(($) => $['operation.cancelAgree'], { ns: 'appDebug' })}
                >
                  <span aria-hidden="true" className="i-ri-thumb-up-line size-4" />
                </IconButton>
              }
            />
          )}
          {feedback?.rating === 'dislike' && (
            <Toggle
              className={destructivePressedClassName}
              pressed
              onPressedChange={(pressed) => !pressed && onFeedback?.({ rating: null })}
              render={
                <IconButton
                  aria-label={t(($) => $['operation.disagree'], { ns: 'appDebug' })}
                  title={t(($) => $['operation.cancelDisagree'], { ns: 'appDebug' })}
                >
                  <span aria-hidden="true" className="i-ri-thumb-down-line size-4" />
                </IconButton>
              }
            />
          )}
        </div>
      )}
    </>
  )
}

export default GenerationActionGroups
