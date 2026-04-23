import type { ReactElement, ReactNode } from 'react'
import type {
  ChatItem,
  Feedback,
} from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import copy from 'copy-to-clipboard'
import {
  memo,
  useId,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import EditReplyModal from '@/app/components/app/annotation/edit-annotation-modal'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import Log from '@/app/components/base/chat/chat/log'
import AnnotationCtrlButton from '@/app/components/base/features/new-feature-panel/annotation-reply/annotation-ctrl-button'
import NewAudioButton from '@/app/components/base/new-audio-button'
import Textarea from '@/app/components/base/textarea'
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

type FeedbackTooltipProps = {
  content: ReactNode
  children: ReactElement
}

const feedbackTooltipClassName = 'max-w-[260px]'

const FeedbackTooltip = ({ content, children }: FeedbackTooltipProps) => {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent className={feedbackTooltipClassName}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

function Operation({
  item,
  question,
  index,
  showPromptLog,
  maxSize,
  contentWidth,
  hasWorkflowProcess,
  noChatInput,
}: OperationProps) {
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
    humanInputFormDataList,
  } = item
  const [userLocalFeedback, setUserLocalFeedback] = useState(feedback)
  const [adminLocalFeedback, setAdminLocalFeedback] = useState(adminFeedback)
  const [feedbackTarget, setFeedbackTarget] = useState<'user' | 'admin'>('user')
  const feedbackTextareaId = useId()

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
  const likeLabel = t('detail.operation.like', { ns: 'appLog' }) || 'Like'
  const dislikeLabel = t('detail.operation.dislike', { ns: 'appLog' }) || 'Dislike'
  const removeFeedbackLabel = t('operation.remove', { ns: 'common' }) || 'Remove'
  const copyLabel = t('operation.copy', { ns: 'common' }) || 'Copy'
  const regenerateLabel = t('operation.regenerate', { ns: 'common' }) || 'Regenerate'

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
    handleFeedback('like', undefined, target)
  }

  const handleDislikeClick = (target: 'user' | 'admin') => {
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
          hasWorkflowProcess && 'right-2 -bottom-4',
          !positionRight && 'right-2 -bottom-4',
          !hasWorkflowProcess && positionRight && 'top-[9px]!',
        )}
        style={(!hasWorkflowProcess && positionRight) ? { left: contentWidth + 8 } : {}}
        data-testid="operation-bar"
      >
        {shouldShowUserFeedbackBar && !humanInputFormDataList?.length && (
          <div className={cn(
            'ml-1 items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs',
            hasUserFeedback ? 'flex' : 'hidden group-hover:flex',
          )}
          >
            {hasUserFeedback
              ? (
                  <FeedbackTooltip
                    content={buildFeedbackTooltip(displayUserFeedback, userFeedbackLabel)}
                  >
                    <ActionButton
                      aria-label={`${userFeedbackLabel}: ${removeFeedbackLabel}`}
                      state={displayUserFeedback?.rating === 'like' ? ActionButtonState.Active : ActionButtonState.Destructive}
                      onClick={() => handleFeedback(null, undefined, 'user')}
                    >
                      {displayUserFeedback?.rating === 'like'
                        ? <span aria-hidden="true" className="i-ri-thumb-up-line h-4 w-4" />
                        : <span aria-hidden="true" className="i-ri-thumb-down-line h-4 w-4" />}
                    </ActionButton>
                  </FeedbackTooltip>
                )
              : (
                  <>
                    <ActionButton
                      aria-label={`${userFeedbackLabel}: ${likeLabel}`}
                      state={displayUserFeedback?.rating === 'like' ? ActionButtonState.Active : ActionButtonState.Default}
                      onClick={() => handleLikeClick('user')}
                    >
                      <span aria-hidden="true" className="i-ri-thumb-up-line h-4 w-4" />
                    </ActionButton>
                    <ActionButton
                      aria-label={`${userFeedbackLabel}: ${dislikeLabel}`}
                      state={displayUserFeedback?.rating === 'dislike' ? ActionButtonState.Destructive : ActionButtonState.Default}
                      onClick={() => handleDislikeClick('user')}
                    >
                      <span aria-hidden="true" className="i-ri-thumb-down-line h-4 w-4" />
                    </ActionButton>
                  </>
                )}
          </div>
        )}
        {shouldShowAdminFeedbackBar && !humanInputFormDataList?.length && (
          <div className={cn(
            'ml-1 items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs',
            (hasAdminFeedback || hasUserFeedback) ? 'flex' : 'hidden group-hover:flex',
          )}
          >
            {displayUserFeedback?.rating && (
              <FeedbackTooltip
                content={buildFeedbackTooltip(displayUserFeedback, userFeedbackLabel)}
              >
                {displayUserFeedback.rating === 'like'
                  ? (
                      <ActionButton aria-label={`${userFeedbackLabel}: ${likeLabel}`} state={ActionButtonState.Active}>
                        <span aria-hidden="true" className="i-ri-thumb-up-line h-4 w-4" />
                      </ActionButton>
                    )
                  : (
                      <ActionButton aria-label={`${userFeedbackLabel}: ${dislikeLabel}`} state={ActionButtonState.Destructive}>
                        <span aria-hidden="true" className="i-ri-thumb-down-line h-4 w-4" />
                      </ActionButton>
                    )}
              </FeedbackTooltip>
            )}

            {displayUserFeedback?.rating && <div className="mx-1 h-3 w-[0.5px] bg-components-actionbar-border" />}
            {hasAdminFeedback
              ? (
                  <FeedbackTooltip
                    content={buildFeedbackTooltip(adminLocalFeedback, adminFeedbackLabel)}
                  >
                    <ActionButton
                      aria-label={`${adminFeedbackLabel}: ${removeFeedbackLabel}`}
                      state={adminLocalFeedback?.rating === 'like' ? ActionButtonState.Active : ActionButtonState.Destructive}
                      onClick={() => handleFeedback(null, undefined, 'admin')}
                    >
                      {adminLocalFeedback?.rating === 'like'
                        ? <span aria-hidden="true" className="i-ri-thumb-up-line h-4 w-4" />
                        : <span aria-hidden="true" className="i-ri-thumb-down-line h-4 w-4" />}
                    </ActionButton>
                  </FeedbackTooltip>
                )
              : (
                  <>
                    <FeedbackTooltip
                      content={buildFeedbackTooltip(adminLocalFeedback, adminFeedbackLabel)}
                    >
                      <ActionButton
                        aria-label={`${adminFeedbackLabel}: ${likeLabel}`}
                        state={adminLocalFeedback?.rating === 'like' ? ActionButtonState.Active : ActionButtonState.Default}
                        onClick={() => handleLikeClick('admin')}
                      >
                        <span aria-hidden="true" className="i-ri-thumb-up-line h-4 w-4" />
                      </ActionButton>
                    </FeedbackTooltip>
                    <FeedbackTooltip
                      content={buildFeedbackTooltip(adminLocalFeedback, adminFeedbackLabel)}
                    >
                      <ActionButton
                        aria-label={`${adminFeedbackLabel}: ${dislikeLabel}`}
                        state={adminLocalFeedback?.rating === 'dislike' ? ActionButtonState.Destructive : ActionButtonState.Default}
                        onClick={() => handleDislikeClick('admin')}
                      >
                        <span aria-hidden="true" className="i-ri-thumb-down-line h-4 w-4" />
                      </ActionButton>
                    </FeedbackTooltip>
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
          <div className="ml-1 hidden items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs group-hover:flex" data-testid="operation-actions">
            {(config?.text_to_speech?.enabled && !humanInputFormDataList?.length) && (
              <NewAudioButton
                id={id}
                value={content}
                voice={config?.text_to_speech?.voice}
              />
            )}
            {!humanInputFormDataList?.length && (
              <ActionButton
                aria-label={copyLabel}
                onClick={() => {
                  copy(content)
                  toast.success(t('actionMsg.copySuccessfully', { ns: 'common' }))
                }}
                data-testid="copy-btn"
              >
                <span aria-hidden="true" className="i-ri-clipboard-line h-4 w-4" />
              </ActionButton>
            )}
            {!noChatInput && (
              <ActionButton aria-label={regenerateLabel} onClick={() => onRegenerate?.(item)} data-testid="regenerate-btn">
                <span aria-hidden="true" className="i-ri-reset-left-line h-4 w-4" />
              </ActionButton>
            )}
            {config?.supportAnnotation && config.annotation_reply?.enabled && !humanInputFormDataList?.length && (
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
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open)
              handleFeedbackCancel()
          }}
        >
          <DialogContent
            backdropProps={{ forceRender: true }}
            className="p-0"
          >
            <div className="flex max-h-[80dvh] flex-col">
              <div className="relative shrink-0 p-6 pr-14 pb-3">
                <DialogTitle className="title-2xl-semi-bold text-text-primary">
                  {t('feedback.title', { ns: 'common' }) || 'Provide Feedback'}
                </DialogTitle>
                <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
                  {t('feedback.subtitle', { ns: 'common' }) || 'Please tell us what went wrong with this response'}
                </DialogDescription>
                <DialogCloseButton className="top-5 right-5 h-8 w-8 rounded-lg" />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
                <label htmlFor={feedbackTextareaId} className="mb-2 block system-sm-semibold text-text-secondary">
                  {t('feedback.content', { ns: 'common' }) || 'Feedback Content'}
                </label>
                <Textarea
                  id={feedbackTextareaId}
                  name="feedback-content"
                  value={feedbackContent}
                  onChange={e => setFeedbackContent(e.target.value)}
                  placeholder={t('feedback.placeholder', { ns: 'common' }) || 'Please describe what went wrong or how we can improve…'}
                  rows={4}
                  className="w-full"
                />
              </div>
              <div className="flex shrink-0 justify-end p-6 pt-5">
                <Button onClick={handleFeedbackCancel}>
                  {t('operation.cancel', { ns: 'common' }) || 'Cancel'}
                </Button>
                <Button
                  className="ml-2"
                  variant="primary"
                  onClick={handleFeedbackSubmit}
                >
                  {t('operation.submit', { ns: 'common' }) || 'Submit'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

export default memo(Operation)
