import type { FC } from 'react'
import {
  memo,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiClipboardLine,
  RiEditLine,
  RiReplay15Line,
  RiThumbDownLine,
  RiThumbUpLine,
} from '@remixicon/react'
import type { ChatItem } from '../../types'
import { useChatContext } from '../context'
import copy from 'copy-to-clipboard'
import Toast from '@/app/components/base/toast'
import EditReplyModal from '@/app/components/app/annotation/edit-annotation-modal'
import Log from '@/app/components/base/chat/chat/log'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import NewAudioButton from '@/app/components/base/new-audio-button'
import cn from '@/utils/classnames'

type OperationProps = {
  item: ChatItem
  question: string
  index: number
  showPromptLog?: boolean
  maxSize: number
  contentWidth: number
  hasWorkflowProcess: boolean
  noChatInput?: boolean
}
const Operation: FC<OperationProps> = ({
  item,
  question,
  index,
  showPromptLog,
  maxSize,
  contentWidth,
  hasWorkflowProcess,
  noChatInput,
}) => {
  const { t } = useTranslation()
  const {
    config,
    onAnnotationAdded,
    onAnnotationEdited,
    onAnnotationRemoved,
    onFeedback,
    onRegenerate,
  } = useChatContext()
  const [isShowReplyModal, setIsShowReplyModal] = useState(false)
  const {
    id,
    isOpeningStatement,
    content: messageContent,
    annotation,
    feedback,
    adminFeedback,
    agent_thoughts,
  } = item
  const [localFeedback, setLocalFeedback] = useState(config?.supportAnnotation ? adminFeedback : feedback)

  const content = useMemo(() => {
    if (agent_thoughts?.length)
      return agent_thoughts.reduce((acc, cur) => acc + cur.thought, '')

    return messageContent
  }, [agent_thoughts, messageContent])

  const handleFeedback = async (rating: 'like' | 'dislike' | null) => {
    if (!config?.supportFeedback || !onFeedback)
      return

    await onFeedback?.(id, { rating })
    setLocalFeedback({ rating })
  }

  const operationWidth = useMemo(() => {
    let width = 0
    if (!isOpeningStatement)
      width += 28
    if (!isOpeningStatement && showPromptLog)
      width += 102 + 8
    if (!isOpeningStatement && config?.text_to_speech?.enabled)
      width += 33
    if (!isOpeningStatement && config?.supportAnnotation && config?.annotation_reply?.enabled)
      width += 56 + 8
    if (config?.supportFeedback && !localFeedback?.rating && onFeedback && !isOpeningStatement)
      width += 60 + 8
    if (config?.supportFeedback && localFeedback?.rating && onFeedback && !isOpeningStatement)
      width += 28 + 8
    return width
  }, [isOpeningStatement, showPromptLog, config?.text_to_speech?.enabled, config?.supportAnnotation, config?.annotation_reply?.enabled, config?.supportFeedback, localFeedback?.rating, onFeedback])

  const positionRight = useMemo(() => operationWidth < maxSize, [operationWidth, maxSize])

  return (
    <>
      <div
        className={cn(
          'absolute flex justify-end gap-1',
          hasWorkflowProcess && '-bottom-4 right-2',
          !positionRight && '-bottom-4 right-2',
          !hasWorkflowProcess && positionRight && '!top-[9px]',
        )}
        style={(!hasWorkflowProcess && positionRight) ? { left: contentWidth + 8 } : {}}
      >
        {showPromptLog && (
          <div className='hidden group-hover:block'>
            <Log logItem={item} />
          </div>
        )}
        {!isOpeningStatement && (
          <div className='hidden group-hover:flex ml-1 items-center gap-0.5 p-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg shadow-md backdrop-blur-sm'>
            {(config?.text_to_speech?.enabled) && (
              <NewAudioButton
                id={id}
                value={content}
                voice={config?.text_to_speech?.voice}
              />
            )}
            <ActionButton onClick={() => {
              copy(content)
              Toast.notify({ type: 'success', message: t('common.actionMsg.copySuccessfully') })
            }}>
              <RiClipboardLine className='w-4 h-4' />
            </ActionButton>
            {!noChatInput && (
              <ActionButton onClick={() => onRegenerate?.(item)}>
                <RiReplay15Line className='w-4 h-4' />
              </ActionButton>
            )}
            {(config?.supportAnnotation && config.annotation_reply?.enabled) && (
              <ActionButton onClick={() => setIsShowReplyModal(true)}>
                <RiEditLine className='w-4 h-4' />
              </ActionButton>
            )}
          </div>
        )}
        {!isOpeningStatement && config?.supportFeedback && onFeedback && (
          <div className='hidden group-hover:flex ml-1 items-center gap-0.5 p-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg shadow-md backdrop-blur-sm'>
            {!localFeedback?.rating && (
              <>
                <ActionButton onClick={() => handleFeedback('like')}>
                  <RiThumbUpLine className='w-4 h-4' />
                </ActionButton>
                <ActionButton onClick={() => handleFeedback('dislike')}>
                  <RiThumbDownLine className='w-4 h-4' />
                </ActionButton>
              </>
            )}
            {localFeedback?.rating === 'like' && (
              <ActionButton state={ActionButtonState.Active} onClick={() => handleFeedback(null)}>
                <RiThumbUpLine className='w-4 h-4' />
              </ActionButton>
            )}
            {localFeedback?.rating === 'dislike' && (
              <ActionButton state={ActionButtonState.Destructive} onClick={() => handleFeedback(null)}>
                <RiThumbDownLine className='w-4 h-4' />
              </ActionButton>
            )}
          </div>
        )}
      </div>
      <EditReplyModal
        isShow={isShowReplyModal}
        onHide={() => setIsShowReplyModal(false)}
        query={question}
        answer={content}
        onEdited={(editedQuery, editedAnswer) => onAnnotationEdited?.(editedQuery, editedAnswer, index)}
        onAdded={(annotationId, authorName, editedQuery, editedAnswer) => onAnnotationAdded?.(annotationId, authorName, editedQuery, editedAnswer, index)}
        appId={config?.appId || ''}
        messageId={id}
        annotationId={annotation?.id || ''}
        createdAt={annotation?.created_at}
        onRemove={() => onAnnotationRemoved?.(index)}
      />
    </>
  )
}

export default memo(Operation)
