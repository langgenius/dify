import type { FC } from 'react'
import {
  memo,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiClipboardLine,
  RiResetLeftLine,
  RiThumbDownLine,
  RiThumbUpLine,
} from '@remixicon/react'
import type { ChatItem } from '../../types'
import { useChatContext } from '../context'
import copy from 'copy-to-clipboard'
import Toast from '@/app/components/base/toast'
import AnnotationCtrlButton from '@/app/components/base/features/new-feature-panel/annotation-reply/annotation-ctrl-button'
import EditReplyModal from '@/app/components/app/annotation/edit-annotation-modal'
import Log from '@/app/components/base/chat/chat/log'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import NewAudioButton from '@/app/components/base/new-audio-button'
import Modal from '@/app/components/base/modal/modal'
import Textarea from '@/app/components/base/textarea'
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
  const [isShowFeedbackModal, setIsShowFeedbackModal] = useState(false)
  const [feedbackContent, setFeedbackContent] = useState('')
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

  const handleFeedback = async (rating: 'like' | 'dislike' | null, content?: string) => {
    if (!config?.supportFeedback || !onFeedback)
      return

    await onFeedback?.(id, { rating, content })
    setLocalFeedback({ rating })
  }

  const handleThumbsDown = () => {
    setIsShowFeedbackModal(true)
  }

  const handleFeedbackSubmit = async () => {
    await handleFeedback('dislike', feedbackContent)
    setFeedbackContent('')
    setIsShowFeedbackModal(false)
  }

  const handleFeedbackCancel = () => {
    setFeedbackContent('')
    setIsShowFeedbackModal(false)
  }

  const operationWidth = useMemo(() => {
    let width = 0
    if (!isOpeningStatement)
      width += 26
    if (!isOpeningStatement && showPromptLog)
      width += 28 + 8
    if (!isOpeningStatement && config?.text_to_speech?.enabled)
      width += 26
    if (!isOpeningStatement && config?.supportAnnotation && config?.annotation_reply?.enabled)
      width += 26
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
        {showPromptLog && !isOpeningStatement && (
          <div className='hidden group-hover:block'>
            <Log logItem={item} />
          </div>
        )}
        {!isOpeningStatement && (
          <div className='ml-1 hidden items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm group-hover:flex'>
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
              <RiClipboardLine className='h-4 w-4' />
            </ActionButton>
            {!noChatInput && (
              <ActionButton onClick={() => onRegenerate?.(item)}>
                <RiResetLeftLine className='h-4 w-4' />
              </ActionButton>
            )}
            {(config?.supportAnnotation && config.annotation_reply?.enabled) && (
              <AnnotationCtrlButton
                appId={config?.appId || ''}
                messageId={id}
                cached={!!annotation?.id}
                query={question}
                answer={content}
                onAdded={(id, authorName) => onAnnotationAdded?.(id, authorName, question, content, index)}
                onEdit={() => setIsShowReplyModal(true)}
              />
            )}
          </div>
        )}
        {!isOpeningStatement && config?.supportFeedback && !localFeedback?.rating && onFeedback && (
          <div className='ml-1 hidden items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm group-hover:flex'>
            {!localFeedback?.rating && (
              <>
                <ActionButton onClick={() => handleFeedback('like')}>
                  <RiThumbUpLine className='h-4 w-4' />
                </ActionButton>
                <ActionButton onClick={handleThumbsDown}>
                  <RiThumbDownLine className='h-4 w-4' />
                </ActionButton>
              </>
            )}
          </div>
        )}
        {!isOpeningStatement && config?.supportFeedback && localFeedback?.rating && onFeedback && (
          <div className='ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm'>
            {localFeedback?.rating === 'like' && (
              <ActionButton state={ActionButtonState.Active} onClick={() => handleFeedback(null)}>
                <RiThumbUpLine className='h-4 w-4' />
              </ActionButton>
            )}
            {localFeedback?.rating === 'dislike' && (
              <ActionButton state={ActionButtonState.Destructive} onClick={() => handleFeedback(null)}>
                <RiThumbDownLine className='h-4 w-4' />
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
      {isShowFeedbackModal && (
        <Modal
          title={t('common.feedback.title') || 'Provide Feedback'}
          subTitle={t('common.feedback.subtitle') || 'Please tell us what went wrong with this response'}
          onClose={handleFeedbackCancel}
          onConfirm={handleFeedbackSubmit}
          onCancel={handleFeedbackCancel}
          confirmButtonText={t('common.operation.submit') || 'Submit'}
          cancelButtonText={t('common.operation.cancel') || 'Cancel'}
        >
          <div className='space-y-3'>
            <div>
              <label className='system-sm-semibold mb-2 block text-text-secondary'>
                {t('common.feedback.content') || 'Feedback Content'}
              </label>
              <Textarea
                value={feedbackContent}
                onChange={e => setFeedbackContent(e.target.value)}
                placeholder={t('common.feedback.placeholder') || 'Please describe what went wrong or how we can improve...'}
                rows={4}
                className='w-full'
              />
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

export default memo(Operation)
