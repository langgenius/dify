'use client'
import type { FC } from 'react'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { AppSourceType } from '@/service/share'
import {
  RiBookmark3Line,
  RiClipboardLine,
  RiFileList3Line,
  RiResetLeftLine,
  RiSparklingLine,
  RiThumbDownLine,
  RiThumbUpLine,
} from '@remixicon/react'
import copy from 'copy-to-clipboard'
import { useTranslation } from 'react-i18next'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import NewAudioButton from '@/app/components/base/new-audio-button'
import { toast } from '@/app/components/base/ui/toast'
import { AppSourceType as AppSourceTypeEnum } from '@/service/share'
import { getCopyContent, MAX_GENERATION_DEPTH } from './utils'

type GenerationActionGroupsProps = {
  appSourceType: AppSourceType
  content: unknown
  currentTab: string
  depth: number
  feedback?: FeedbackType
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
      {!isInWebApp && (appSourceType !== AppSourceTypeEnum.installedApp) && !isResponding && (
        <div className="ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs">
          <ActionButton
            aria-label={t('operation.log', { ns: 'common' })}
            disabled={isError || !messageId}
            title={t('operation.log', { ns: 'common' })}
            onClick={onOpenLogModal}
          >
            <RiFileList3Line className="h-4 w-4" />
          </ActionButton>
        </div>
      )}
      <div className="ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs">
        {moreLikeThis && !isTryApp && (
          <ActionButton
            aria-label={t('feature.moreLikeThis.title', { ns: 'appDebug' })}
            state={depth === MAX_GENERATION_DEPTH ? ActionButtonState.Disabled : ActionButtonState.Default}
            disabled={depth === MAX_GENERATION_DEPTH}
            title={t('feature.moreLikeThis.title', { ns: 'appDebug' })}
            onClick={onMoreLikeThis}
          >
            <RiSparklingLine className="h-4 w-4" />
          </ActionButton>
        )}
        {isShowTextToSpeech && !isTryApp && (
          <NewAudioButton
            id={messageId!}
            voice={voice}
          />
        )}
        {showCopyAction && (
          <ActionButton
            aria-label={t('operation.copy', { ns: 'common' })}
            disabled={isError || !messageId}
            title={t('operation.copy', { ns: 'common' })}
            onClick={() => {
              const copyContent = getCopyContent({ content, isWorkflow, workflowProcessData })
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
          <ActionButton
            aria-label={t('generation.batchFailed.retry', { ns: 'share' })}
            title={t('generation.batchFailed.retry', { ns: 'share' })}
            onClick={onRetry}
          >
            <RiResetLeftLine className="h-4 w-4" />
          </ActionButton>
        )}
        {isInWebApp && !isWorkflow && !isTryApp && (
          <ActionButton
            aria-label={t('operation.save', { ns: 'common' })}
            disabled={isError || !messageId}
            title={t('operation.save', { ns: 'common' })}
            onClick={() => { onSave?.(messageId as string) }}
          >
            <RiBookmark3Line className="h-4 w-4" />
          </ActionButton>
        )}
      </div>
      {(supportFeedback || isInWebApp) && !isWorkflow && !isTryApp && !isError && messageId && (
        <div className="ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs">
          {!feedback?.rating && (
            <>
              <ActionButton
                aria-label={t('operation.agree', { ns: 'appDebug' })}
                title={t('operation.agree', { ns: 'appDebug' })}
                onClick={() => onFeedback?.({ rating: 'like' })}
              >
                <RiThumbUpLine className="h-4 w-4" />
              </ActionButton>
              <ActionButton
                aria-label={t('operation.disagree', { ns: 'appDebug' })}
                title={t('operation.disagree', { ns: 'appDebug' })}
                onClick={() => onFeedback?.({ rating: 'dislike' })}
              >
                <RiThumbDownLine className="h-4 w-4" />
              </ActionButton>
            </>
          )}
          {feedback?.rating === 'like' && (
            <ActionButton
              aria-label={t('operation.cancelAgree', { ns: 'appDebug' })}
              state={ActionButtonState.Active}
              title={t('operation.cancelAgree', { ns: 'appDebug' })}
              onClick={() => onFeedback?.({ rating: null })}
            >
              <RiThumbUpLine className="h-4 w-4" />
            </ActionButton>
          )}
          {feedback?.rating === 'dislike' && (
            <ActionButton
              aria-label={t('operation.cancelDisagree', { ns: 'appDebug' })}
              state={ActionButtonState.Destructive}
              title={t('operation.cancelDisagree', { ns: 'appDebug' })}
              onClick={() => onFeedback?.({ rating: null })}
            >
              <RiThumbDownLine className="h-4 w-4" />
            </ActionButton>
          )}
        </div>
      )}
    </>
  )
}

export default GenerationActionGroups
