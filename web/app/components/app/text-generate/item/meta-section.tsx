import type { FC } from 'react'
import type { TFunction } from 'i18next'
import {
  RiBookmark3Line,
  RiClipboardLine,
  RiFileList3Line,
  RiReplay15Line,
  RiSparklingLine,
  RiThumbDownLine,
  RiThumbUpLine,
} from '@remixicon/react'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import NewAudioButton from '@/app/components/base/new-audio-button'
import cn from '@/utils/classnames'

type FeedbackActionsProps = {
  feedback?: FeedbackType
  onFeedback?: (feedback: FeedbackType) => void
}

const FeedbackActions: FC<FeedbackActionsProps> = ({
  feedback,
  onFeedback,
}) => {
  if (!feedback?.rating) {
    return (
      <>
        <ActionButton onClick={() => onFeedback?.({ rating: 'like' })}>
          <RiThumbUpLine className='h-4 w-4' />
        </ActionButton>
        <ActionButton onClick={() => onFeedback?.({ rating: 'dislike' })}>
          <RiThumbDownLine className='h-4 w-4' />
        </ActionButton>
      </>
    )
  }

  if (feedback.rating === 'like') {
    return (
      <ActionButton state={ActionButtonState.Active} onClick={() => onFeedback?.({ rating: null })}>
        <RiThumbUpLine className='h-4 w-4' />
      </ActionButton>
    )
  }

  return (
    <ActionButton state={ActionButtonState.Destructive} onClick={() => onFeedback?.({ rating: null })}>
      <RiThumbDownLine className='h-4 w-4' />
    </ActionButton>
  )
}

type MetaSectionProps = {
  showCharCount: boolean
  charCount?: number
  t: TFunction
  shouldIndentForChild: boolean
  isInWebApp?: boolean
  isInstalledApp: boolean
  isResponding?: boolean
  isError: boolean
  messageId?: string | null
  onOpenLogModal: () => void
  moreLikeThis?: boolean
  onMoreLikeThis: () => void
  disableMoreLikeThis: boolean
  isShowTextToSpeech?: boolean
  textToSpeechVoice?: string
  canCopy: boolean
  onCopy: () => void
  onRetry: () => void
  isWorkflow?: boolean
  onSave?: (messageId: string) => void
  feedback?: FeedbackType
  onFeedback?: (feedback: FeedbackType) => void
  supportFeedback?: boolean
}

const MetaSection: FC<MetaSectionProps> = ({
  showCharCount,
  charCount,
  t,
  shouldIndentForChild,
  isInWebApp,
  isInstalledApp,
  isResponding,
  isError,
  messageId,
  onOpenLogModal,
  moreLikeThis,
  onMoreLikeThis,
  disableMoreLikeThis,
  isShowTextToSpeech,
  textToSpeechVoice,
  canCopy,
  onCopy,
  onRetry,
  isWorkflow,
  onSave,
  feedback,
  onFeedback,
  supportFeedback,
}) => {
  return (
    <div className={cn(
      'system-xs-regular relative mt-1 h-4 px-4 text-text-quaternary',
      shouldIndentForChild && 'pl-10',
    )}>
      {showCharCount && <span>{charCount} {t('common.unit.char')}</span>}
      <div className='absolute bottom-1 right-2 flex items-center'>
        {!isInWebApp && !isInstalledApp && !isResponding && (
          <div className='ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm'>
            <ActionButton disabled={isError || !messageId} onClick={onOpenLogModal}>
              <RiFileList3Line className='h-4 w-4' />
            </ActionButton>
          </div>
        )}
        <div className='ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm'>
          {moreLikeThis && (
            <ActionButton state={disableMoreLikeThis ? ActionButtonState.Disabled : ActionButtonState.Default} disabled={disableMoreLikeThis} onClick={onMoreLikeThis}>
              <RiSparklingLine className='h-4 w-4' />
            </ActionButton>
          )}
          {isShowTextToSpeech && messageId && (
            <NewAudioButton
              id={messageId}
              voice={textToSpeechVoice}
            />
          )}
          {canCopy && (
            <ActionButton disabled={isError || !messageId} onClick={onCopy}>
              <RiClipboardLine className='h-4 w-4' />
            </ActionButton>
          )}
          {isInWebApp && isError && (
            <ActionButton onClick={onRetry}>
              <RiReplay15Line className='h-4 w-4' />
            </ActionButton>
          )}
          {isInWebApp && !isWorkflow && (
            <ActionButton disabled={isError || !messageId} onClick={() => { onSave?.(messageId as string) }}>
              <RiBookmark3Line className='h-4 w-4' />
            </ActionButton>
          )}
        </div>
        {(supportFeedback || isInWebApp) && !isWorkflow && !isError && messageId && (
          <div className='ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm'>
            <FeedbackActions feedback={feedback} onFeedback={onFeedback} />
          </div>
        )}
      </div>
    </div>
  )
}

export default MetaSection
