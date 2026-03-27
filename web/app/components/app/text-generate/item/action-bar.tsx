'use client'

import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import {
  RiBookmark3Line,
  RiClipboardLine,
  RiFileList3Line,
  RiResetLeftLine,
  RiSparklingLine,
  RiThumbDownLine,
  RiThumbUpLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import NewAudioButton from '@/app/components/base/new-audio-button'
import { AppSourceType } from '@/service/share'

type GenerationItemActionBarProps = {
  appSourceType: AppSourceType
  currentTab: string
  depth: number
  feedback?: FeedbackType
  isError: boolean
  isInWebApp: boolean
  isResponding?: boolean
  isShowTextToSpeech?: boolean
  isTryApp: boolean
  isWorkflow?: boolean
  messageId?: string | null
  moreLikeThis?: boolean
  onCopy: () => void
  onFeedback?: (feedback: FeedbackType) => void
  onMoreLikeThis: () => void
  onOpenLogModal: () => void
  onRetry: () => void
  onSave?: (messageId: string) => void
  supportFeedback?: boolean
  voice?: string
  workflowProcessData?: WorkflowProcess
}

const MAX_DEPTH = 3

const GenerationItemActionBar = ({
  appSourceType,
  currentTab,
  depth,
  feedback,
  isError,
  isInWebApp,
  isResponding,
  isShowTextToSpeech,
  isTryApp,
  isWorkflow,
  messageId,
  moreLikeThis,
  onCopy,
  onFeedback,
  onMoreLikeThis,
  onOpenLogModal,
  onRetry,
  onSave,
  supportFeedback,
  voice,
  workflowProcessData,
}: GenerationItemActionBarProps) => {
  const { t } = useTranslation()

  return (
    <>
      {!isInWebApp && appSourceType !== AppSourceType.installedApp && !isResponding && (
        <div className="ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm">
          <ActionButton disabled={isError || !messageId} onClick={onOpenLogModal}>
            <RiFileList3Line className="h-4 w-4" />
          </ActionButton>
        </div>
      )}
      <div className="ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm">
        {moreLikeThis && !isTryApp && (
          <ActionButton state={depth === MAX_DEPTH ? ActionButtonState.Disabled : ActionButtonState.Default} disabled={depth === MAX_DEPTH} onClick={onMoreLikeThis}>
            <RiSparklingLine className="h-4 w-4" />
          </ActionButton>
        )}
        {isShowTextToSpeech && !isTryApp && messageId && (
          <NewAudioButton
            id={messageId}
            voice={voice}
          />
        )}
        {((currentTab === 'RESULT' && workflowProcessData?.resultText) || !isWorkflow) && (
          <ActionButton
            disabled={isError || !messageId}
            onClick={onCopy}
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
          <ActionButton disabled={isError || !messageId} onClick={() => messageId && onSave?.(messageId)}>
            <RiBookmark3Line className="h-4 w-4" />
          </ActionButton>
        )}
      </div>
      {(supportFeedback || isInWebApp) && !isWorkflow && !isTryApp && !isError && messageId && (
        <div className="ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm">
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
      {depth > MAX_DEPTH && (
        <span className="sr-only">{t('errorMessage.waitForResponse', { ns: 'appDebug' })}</span>
      )}
    </>
  )
}

export default GenerationItemActionBar
