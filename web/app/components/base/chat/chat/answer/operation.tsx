import type { FC } from 'react'
import type {
  ChatItem,
  Feedback,
} from '../../types'
import {
  RiClipboardLine,
  RiResetLeftLine,
  RiThumbDownLine,
  RiThumbUpLine,
} from '@remixicon/react'
import copy from 'copy-to-clipboard'
import {
  memo,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import EditReplyModal from '@/app/components/app/annotation/edit-annotation-modal'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import Log from '@/app/components/base/chat/chat/log'
import AnnotationCtrlButton from '@/app/components/base/features/new-feature-panel/annotation-reply/annotation-ctrl-button'
import Modal from '@/app/components/base/modal/modal'
import NewAudioButton from '@/app/components/base/new-audio-button'
import Textarea from '@/app/components/base/textarea'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'
import { useChatContext } from '../context'

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
  const [userLocalFeedback, setUserLocalFeedback] = useState(feedback)
  const [adminLocalFeedback, setAdminLocalFeedback] = useState(adminFeedback)
  const [feedbackTarget, setFeedbackTarget] = useState<'user' | 'admin'>('user')

  // Separate feedback types for display
  const userFeedback = feedback

  const content = useMemo(() => {
    if (agent_thoughts?.length)
      return agent_thoughts.reduce((acc, cur) => acc + cur.thought, '')

    return messageContent
  }, [agent_thoughts, messageContent])

  const displayUserFeedback = userLocalFeedback ?? userFeedback

  const hasUserFeedback = !!displayUserFeedback?.rating
  const hasAdminFeedback = !!adminLocalFeedback?.rating

  const shouldShowUserFeedbackBar = !isOpeningStatement && config?.supportFeedback && !!onFeedback && !config?.supportAnnotation
  const shouldShowAdminFeedbackBar = !isOpeningStatement && config?.supportFeedback && !!onFeedback && !!config?.supportAnnotation

  const userFeedbackLabel = t('table.header.userRate', { ns: 'appLog' }) || 'User feedback'
  const adminFeedbackLabel = t('table.header.adminRate', { ns: 'appLog' }) || 'Admin feedback'
  const feedbackTooltipClassName = 'max-w-[260px]'

  const buildFeedbackTooltip = (feedbackData?: Feedback | null, label = userFeedbackLabel) => {
    if (!feedbackData?.rating)
      return label

    const ratingLabel = feedbackData.rating === 'like'
      ? (t('detail.operation.like', { ns: 'appLog' }) || 'like')
      : (t('detail.operation.dislike', { ns: 'appLog' }) || 'dislike')
    const feedbackText = feedbackData.content?.trim()

    if (feedbackText)
      return `${label}: ${ratingLabel} - ${feedbackText}`

    return `${label}: ${ratingLabel}`
  }

  const handleFeedback = async (rating: 'like' | 'dislike' | null, content?: string, target: 'user' | 'admin' = 'user') => {
    if (!config?.supportFeedback || !onFeedback)
      return

    await onFeedback?.(id, { rating, content })

    const nextFeedback = rating === null ? { rating: null } : { rating, content }

    if (target === 'admin')
      setAdminLocalFeedback(nextFeedback)
    else
      setUserLocalFeedback(nextFeedback)
  }

  const handleLikeClick = (target: 'user' | 'admin') => {
    const currentRating = target === 'admin' ? adminLocalFeedback?.rating : displayUserFeedback?.rating
    if (currentRating === 'like') {
      handleFeedback(null, undefined, target)
      return
    }
    handleFeedback('like', undefined, target)
  }

  const handleDislikeClick = (target: 'user' | 'admin') => {
    const currentRating = target === 'admin' ? adminLocalFeedback?.rating : displayUserFeedback?.rating
    if (currentRating === 'dislike') {
      handleFeedback(null, undefined, target)
      return
    }
    setFeedbackTarget(target)
    setIsShowFeedbackModal(true)
  }

  const handleFeedbackSubmit = async () => {
    await handleFeedback('dislike', feedbackContent, feedbackTarget)
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
    if (shouldShowUserFeedbackBar)
      width += hasUserFeedback ? 28 + 8 : 60 + 8
    if (shouldShowAdminFeedbackBar)
      width += (hasAdminFeedback ? 28 : 60) + 8 + (hasUserFeedback ? 28 : 0)

    return width
  }, [config?.annotation_reply?.enabled, config?.supportAnnotation, config?.text_to_speech?.enabled, hasAdminFeedback, hasUserFeedback, isOpeningStatement, shouldShowAdminFeedbackBar, shouldShowUserFeedbackBar, showPromptLog])

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
        {shouldShowUserFeedbackBar && (
          <div className={cn(
            'ml-1 items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm',
            hasUserFeedback ? 'flex' : 'hidden group-hover:flex',
          )}
          >
            {hasUserFeedback
              ? (
                  <Tooltip
                    popupContent={buildFeedbackTooltip(displayUserFeedback, userFeedbackLabel)}
                    popupClassName={feedbackTooltipClassName}
                  >
                    <ActionButton
                      state={displayUserFeedback?.rating === 'like' ? ActionButtonState.Active : ActionButtonState.Destructive}
                      onClick={() => handleFeedback(null, undefined, 'user')}
                    >
                      {displayUserFeedback?.rating === 'like'
                        ? <RiThumbUpLine className="h-4 w-4" />
                        : <RiThumbDownLine className="h-4 w-4" />}
                    </ActionButton>
                  </Tooltip>
                )
              : (
                  <>
                    <ActionButton
                      state={displayUserFeedback?.rating === 'like' ? ActionButtonState.Active : ActionButtonState.Default}
                      onClick={() => handleLikeClick('user')}
                    >
                      <RiThumbUpLine className="h-4 w-4" />
                    </ActionButton>
                    <ActionButton
                      state={displayUserFeedback?.rating === 'dislike' ? ActionButtonState.Destructive : ActionButtonState.Default}
                      onClick={() => handleDislikeClick('user')}
                    >
                      <RiThumbDownLine className="h-4 w-4" />
                    </ActionButton>
                  </>
                )}
          </div>
        )}
        {shouldShowAdminFeedbackBar && (
          <div className={cn(
            'ml-1 items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm',
            (hasAdminFeedback || hasUserFeedback) ? 'flex' : 'hidden group-hover:flex',
          )}
          >
            {/* User Feedback Display */}
            {displayUserFeedback?.rating && (
              <Tooltip
                popupContent={buildFeedbackTooltip(displayUserFeedback, userFeedbackLabel)}
                popupClassName={feedbackTooltipClassName}
              >
                {displayUserFeedback.rating === 'like'
                  ? (
                      <ActionButton state={ActionButtonState.Active}>
                        <RiThumbUpLine className="h-4 w-4" />
                      </ActionButton>
                    )
                  : (
                      <ActionButton state={ActionButtonState.Destructive}>
                        <RiThumbDownLine className="h-4 w-4" />
                      </ActionButton>
                    )}
              </Tooltip>
            )}

            {/* Admin Feedback Controls */}
            {displayUserFeedback?.rating && <div className="mx-1 h-3 w-[0.5px] bg-components-actionbar-border" />}
            {hasAdminFeedback
              ? (
                  <Tooltip
                    popupContent={buildFeedbackTooltip(adminLocalFeedback, adminFeedbackLabel)}
                    popupClassName={feedbackTooltipClassName}
                  >
                    <ActionButton
                      state={adminLocalFeedback?.rating === 'like' ? ActionButtonState.Active : ActionButtonState.Destructive}
                      onClick={() => handleFeedback(null, undefined, 'admin')}
                    >
                      {adminLocalFeedback?.rating === 'like'
                        ? <RiThumbUpLine className="h-4 w-4" />
                        : <RiThumbDownLine className="h-4 w-4" />}
                    </ActionButton>
                  </Tooltip>
                )
              : (
                  <>
                    <Tooltip
                      popupContent={buildFeedbackTooltip(adminLocalFeedback, adminFeedbackLabel)}
                      popupClassName={feedbackTooltipClassName}
                    >
                      <ActionButton
                        state={adminLocalFeedback?.rating === 'like' ? ActionButtonState.Active : ActionButtonState.Default}
                        onClick={() => handleLikeClick('admin')}
                      >
                        <RiThumbUpLine className="h-4 w-4" />
                      </ActionButton>
                    </Tooltip>
                    <Tooltip
                      popupContent={buildFeedbackTooltip(adminLocalFeedback, adminFeedbackLabel)}
                      popupClassName={feedbackTooltipClassName}
                    >
                      <ActionButton
                        state={adminLocalFeedback?.rating === 'dislike' ? ActionButtonState.Destructive : ActionButtonState.Default}
                        onClick={() => handleDislikeClick('admin')}
                      >
                        <RiThumbDownLine className="h-4 w-4" />
                      </ActionButton>
                    </Tooltip>
                  </>
                )}
          </div>
        )}
        {showPromptLog && !isOpeningStatement && (
          <div className="hidden group-hover:block">
            <Log logItem={item} />
          </div>
        )}
        {!isOpeningStatement && (
          <div className="ml-1 hidden items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm group-hover:flex">
            {(config?.text_to_speech?.enabled) && (
              <NewAudioButton
                id={id}
                value={content}
                voice={config?.text_to_speech?.voice}
              />
            )}
            <ActionButton onClick={() => {
              copy(content)
              Toast.notify({ type: 'success', message: t('actionMsg.copySuccessfully', { ns: 'common' }) })
            }}
            >
              <RiClipboardLine className="h-4 w-4" />
            </ActionButton>
            {!noChatInput && (
              <ActionButton onClick={() => onRegenerate?.(item)}>
                <RiResetLeftLine className="h-4 w-4" />
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
          title={t('feedback.title', { ns: 'common' }) || 'Provide Feedback'}
          subTitle={t('feedback.subtitle', { ns: 'common' }) || 'Please tell us what went wrong with this response'}
          onClose={handleFeedbackCancel}
          onConfirm={handleFeedbackSubmit}
          onCancel={handleFeedbackCancel}
          confirmButtonText={t('operation.submit', { ns: 'common' }) || 'Submit'}
          cancelButtonText={t('operation.cancel', { ns: 'common' }) || 'Cancel'}
        >
          <div className="space-y-3">
            <div>
              <label className="system-sm-semibold mb-2 block text-text-secondary">
                {t('feedback.content', { ns: 'common' }) || 'Feedback Content'}
              </label>
              <Textarea
                value={feedbackContent}
                onChange={e => setFeedbackContent(e.target.value)}
                placeholder={t('feedback.placeholder', { ns: 'common' }) || 'Please describe what went wrong or how we can improve...'}
                rows={4}
                className="w-full"
              />
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

export default memo(Operation)
