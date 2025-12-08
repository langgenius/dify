import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiBookmark3Line,
  RiClipboardLine,
  RiFileList3Line,
  RiReplay15Line,
  RiSparklingLine,
  RiThumbDownLine,
  RiThumbUpLine,
} from '@remixicon/react'
import copy from 'copy-to-clipboard'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import NewAudioButton from '@/app/components/base/new-audio-button'
import Toast from '@/app/components/base/toast'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import cn from '@/utils/classnames'
import { MAX_DEPTH, type WorkflowTab } from './hooks'

type ActionBarProps = {
  isWorkflow?: boolean
  content: any
  isMobile?: boolean
  hasChildItem: boolean
  isInWebApp?: boolean
  isInstalledApp: boolean
  isResponding?: boolean
  isError: boolean
  messageId?: string | null
  moreLikeThis?: boolean
  depth: number
  onMoreLikeThis: () => void
  onOpenLog: () => void
  isShowTextToSpeech?: boolean
  voiceId?: string
  onRetry: () => void
  onSave?: (messageId: string) => void
  feedback?: FeedbackType
  onFeedback?: (feedback: FeedbackType) => void
  supportFeedback?: boolean
  workflowProcessData?: WorkflowProcess
  currentTab: WorkflowTab
}

const ActionBar: FC<ActionBarProps> = ({
  isWorkflow,
  content,
  isMobile,
  hasChildItem,
  isInWebApp,
  isInstalledApp,
  isResponding,
  isError,
  messageId,
  moreLikeThis,
  depth,
  onMoreLikeThis,
  onOpenLog,
  isShowTextToSpeech,
  voiceId,
  onRetry,
  onSave,
  feedback,
  onFeedback,
  supportFeedback,
  workflowProcessData,
  currentTab,
}) => {
  const { t } = useTranslation()
  const showCopyButton = ((currentTab === 'RESULT' && workflowProcessData?.resultText) || !isWorkflow) && !isResponding

  const handleCopy = () => {
    const copyContent = isWorkflow ? workflowProcessData?.resultText : content
    if (typeof copyContent === 'string')
      copy(copyContent)
    else
      copy(JSON.stringify(copyContent))
    Toast.notify({ type: 'success', message: t('common.actionMsg.copySuccessfully') })
  }

  return (
    <div className={cn(
      'system-xs-regular relative mt-1 h-4 px-4 text-text-quaternary',
      isMobile && hasChildItem && 'pl-10',
    )}>
      {!isWorkflow && <span>{content?.length} {t('common.unit.char')}</span>}
      <div className='absolute bottom-1 right-2 flex items-center'>
        {!isInWebApp && !isInstalledApp && !isResponding && (
          <div className='ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm'>
            <ActionButton disabled={isError || !messageId} onClick={onOpenLog}>
              <RiFileList3Line className='h-4 w-4' />
            </ActionButton>
          </div>
        )}
        <div className='ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm'>
          {moreLikeThis && (
            <ActionButton state={depth === MAX_DEPTH ? ActionButtonState.Disabled : ActionButtonState.Default} disabled={depth === MAX_DEPTH} onClick={onMoreLikeThis}>
              <RiSparklingLine className='h-4 w-4' />
            </ActionButton>
          )}
          {isShowTextToSpeech && messageId && (
            <NewAudioButton
              id={messageId}
              voice={voiceId}
            />
          )}
          {showCopyButton && (
            <ActionButton disabled={isError || !messageId} onClick={handleCopy}>
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
        {(supportFeedback || isInWebApp) && !isWorkflow && !isError && messageId && !isResponding && (
          <div className='ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm'>
            {!feedback?.rating && (
              <>
                <ActionButton onClick={() => onFeedback?.({ rating: 'like' })}>
                  <RiThumbUpLine className='h-4 w-4' />
                </ActionButton>
                <ActionButton onClick={() => onFeedback?.({ rating: 'dislike' })}>
                  <RiThumbDownLine className='h-4 w-4' />
                </ActionButton>
              </>
            )}
            {feedback?.rating === 'like' && (
              <ActionButton state={ActionButtonState.Active} onClick={() => onFeedback?.({ rating: null })}>
                <RiThumbUpLine className='h-4 w-4' />
              </ActionButton>
            )}
            {feedback?.rating === 'dislike' && (
              <ActionButton state={ActionButtonState.Destructive} onClick={() => onFeedback?.({ rating: null })}>
                <RiThumbDownLine className='h-4 w-4' />
              </ActionButton>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ActionBar
