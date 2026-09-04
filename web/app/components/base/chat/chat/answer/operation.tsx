import type { ReactElement, ReactNode } from 'react'
import type { ChatItem, Feedback } from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { Toggle } from '@langgenius/dify-ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import copy from 'copy-to-clipboard'
import { memo, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import EditReplyModal from '@/app/components/app/annotation/edit-annotation-modal'
import Log from '@/app/components/base/chat/chat/log'
import AnnotationCtrlButton from '@/app/components/base/features/new-feature-panel/annotation-reply/annotation-ctrl-button'
import NewAudioButton from '@/app/components/base/new-audio-button'
import { useChatContext } from '../context'

type OperationProps = {
  answerActionPosition?: AnswerActionPosition
  item: ChatItem
  question: string
  index: number
  showPromptLog?: boolean
  maxSize: number
  contentWidth: number
  hasWorkflowProcess: boolean
  noChatInput?: boolean
}

export type AnswerActionPosition = 'auto' | 'below'

type FeedbackTooltipProps = {
  content: ReactNode
  children: ReactElement
}

const feedbackTooltipClassName = 'max-w-[260px]'
const answerActiveFlexClassName = 'group-hover:flex group-has-[[data-popup-open]]:flex'
const answerActiveBlockClassName = 'group-hover:block group-has-[[data-popup-open]]:block'
const accentPressedClassName =
  'data-pressed:bg-state-accent-active data-pressed:text-text-accent data-pressed:hover:bg-state-accent-active-alt'
const destructivePressedClassName =
  'data-pressed:bg-state-destructive-hover data-pressed:text-text-destructive data-pressed:hover:bg-state-destructive-hover data-pressed:hover:text-text-destructive'

function joinPublicContent(blocks: Array<string | undefined>) {
  return blocks.filter((block): block is string => !!block?.trim()).join('\n\n')
}

function getPublicResponseContent(item: ChatItem) {
  if (item.content.trim()) return item.content

  const responseContent = joinPublicContent(
    item.agent_response_parts?.map((part) =>
      part.type === 'message' ? part.content : undefined,
    ) ?? [],
  )
  if (responseContent) return responseContent

  return joinPublicContent(item.agent_thoughts?.map((thought) => thought.answer) ?? [])
}

const FeedbackTooltip = ({ content, children }: FeedbackTooltipProps) => {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent className={feedbackTooltipClassName}>{content}</TooltipContent>
    </Tooltip>
  )
}

function Operation({
  answerActionPosition = 'auto',
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
    showRegenerate,
    readonly,
  } = useChatContext()
  const [isShowReplyModal, setIsShowReplyModal] = useState(false)
  const [isShowFeedbackModal, setIsShowFeedbackModal] = useState(false)
  const [feedbackContent, setFeedbackContent] = useState('')
  const { id, isOpeningStatement, annotation, feedback, adminFeedback, humanInputFormDataList } =
    item
  const [userFeedbackOverride, setUserFeedbackOverride] = useState<Feedback>()
  const [adminFeedbackOverride, setAdminFeedbackOverride] = useState<Feedback>()
  const [feedbackTarget, setFeedbackTarget] = useState<'user' | 'admin'>('user')
  const feedbackTextareaId = useId()

  const content = getPublicResponseContent(item)
  const hasPublicContent = !!content.trim()

  const displayUserFeedback = userFeedbackOverride ?? feedback
  const displayAdminFeedback = adminFeedbackOverride ?? adminFeedback

  const hasUserFeedback = !!displayUserFeedback?.rating
  const hasAdminFeedback = !!displayAdminFeedback?.rating

  const shouldShowUserFeedbackBar =
    !isOpeningStatement && config?.supportFeedback && !!onFeedback && !config?.supportAnnotation
  const shouldShowAdminFeedbackBar =
    !isOpeningStatement && config?.supportFeedback && !!onFeedback && !!config?.supportAnnotation
  const canManageAnnotation =
    !readonly && !!onAnnotationAdded && !!onAnnotationEdited && !!onAnnotationRemoved
  const shouldShowAnnotationAction =
    canManageAnnotation &&
    hasPublicContent &&
    !!config?.supportAnnotation &&
    !!config.annotation_reply?.enabled &&
    !humanInputFormDataList?.length

  const userFeedbackLabel =
    t(($) => $['table.header.userRate'], { ns: 'appLog' }) || 'User feedback'
  const adminFeedbackLabel =
    t(($) => $['table.header.adminRate'], { ns: 'appLog' }) || 'Admin feedback'
  const likeLabel = t(($) => $['detail.operation.like'], { ns: 'appLog' }) || 'Like'
  const dislikeLabel = t(($) => $['detail.operation.dislike'], { ns: 'appLog' }) || 'Dislike'
  const copyLabel = t(($) => $['operation.copy'], { ns: 'common' }) || 'Copy'
  const regenerateLabel = t(($) => $['operation.regenerate'], { ns: 'common' }) || 'Regenerate'

  const buildFeedbackTooltip = (feedbackData?: Feedback | null, label = userFeedbackLabel) => {
    if (!feedbackData?.rating) return label

    const ratingLabel =
      feedbackData.rating === 'like'
        ? t(($) => $['detail.operation.like'], { ns: 'appLog' }) || 'like'
        : t(($) => $['detail.operation.dislike'], { ns: 'appLog' }) || 'dislike'
    const feedbackText = feedbackData.content?.trim()

    if (feedbackText) return `${label}: ${ratingLabel} - ${feedbackText}`

    return `${label}: ${ratingLabel}`
  }

  const handleFeedback = async (
    rating: 'like' | 'dislike' | null,
    content?: string,
    target: 'user' | 'admin' = 'user',
  ) => {
    if (!config?.supportFeedback || !onFeedback) return false

    try {
      await onFeedback(id, { rating, content })

      const nextFeedback = rating === null ? { rating: null } : { rating, content }

      if (target === 'admin') setAdminFeedbackOverride(nextFeedback)
      else setUserFeedbackOverride(nextFeedback)
      return true
    } catch {
      return false
    }
  }

  const handleLikeClick = (target: 'user' | 'admin') => {
    void handleFeedback('like', undefined, target)
  }

  const handleDislikeClick = (target: 'user' | 'admin') => {
    setFeedbackTarget(target)
    setIsShowFeedbackModal(true)
  }

  const handleFeedbackSubmit = async () => {
    const succeeded = await handleFeedback('dislike', feedbackContent, feedbackTarget)
    if (!succeeded) return

    setFeedbackContent('')
    setIsShowFeedbackModal(false)
  }

  const handleFeedbackCancel = () => {
    setFeedbackContent('')
    setIsShowFeedbackModal(false)
  }

  const operationWidth = useMemo(() => {
    let width = 0
    if (!isOpeningStatement) width += 26
    if (!isOpeningStatement && showPromptLog) width += 28 + 8
    if (!isOpeningStatement && config?.text_to_speech?.enabled && hasPublicContent) width += 26
    if (!isOpeningStatement && shouldShowAnnotationAction) width += 26
    if (shouldShowUserFeedbackBar) width += hasUserFeedback ? 28 + 8 : 60 + 8
    if (shouldShowAdminFeedbackBar)
      width += (hasAdminFeedback ? 28 : 60) + 8 + (hasUserFeedback ? 28 : 0)

    return width
  }, [
    config?.text_to_speech?.enabled,
    hasAdminFeedback,
    hasPublicContent,
    hasUserFeedback,
    isOpeningStatement,
    shouldShowAdminFeedbackBar,
    shouldShowAnnotationAction,
    shouldShowUserFeedbackBar,
    showPromptLog,
  ])

  const positionRight = useMemo(
    () => answerActionPosition === 'auto' && operationWidth < maxSize,
    [answerActionPosition, operationWidth, maxSize],
  )

  return (
    <>
      <div
        className={cn(
          'absolute flex justify-end gap-1',
          hasWorkflowProcess && 'right-2 -bottom-4',
          !positionRight && 'right-2 -bottom-4',
          !hasWorkflowProcess && positionRight && 'top-2.25!',
        )}
        style={!hasWorkflowProcess && positionRight ? { left: contentWidth + 8 } : {}}
        data-testid="operation-bar"
      >
        {shouldShowUserFeedbackBar && !humanInputFormDataList?.length && (
          <div
            className={cn(
              'ml-1 items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs',
              hasUserFeedback ? 'flex' : `hidden ${answerActiveFlexClassName}`,
            )}
          >
            {hasUserFeedback ? (
              <FeedbackTooltip
                content={buildFeedbackTooltip(displayUserFeedback, userFeedbackLabel)}
              >
                <Toggle
                  className={
                    displayUserFeedback?.rating === 'like'
                      ? accentPressedClassName
                      : destructivePressedClassName
                  }
                  pressed
                  onPressedChange={(pressed) =>
                    !pressed && void handleFeedback(null, undefined, 'user')
                  }
                  render={
                    <IconButton
                      aria-label={`${userFeedbackLabel}: ${displayUserFeedback?.rating === 'like' ? likeLabel : dislikeLabel}`}
                    >
                      {displayUserFeedback?.rating === 'like' ? (
                        <span aria-hidden="true" className="i-ri-thumb-up-line size-4" />
                      ) : (
                        <span aria-hidden="true" className="i-ri-thumb-down-line size-4" />
                      )}
                    </IconButton>
                  }
                />
              </FeedbackTooltip>
            ) : (
              <>
                <Toggle
                  className={accentPressedClassName}
                  pressed={false}
                  onPressedChange={(pressed) => pressed && handleLikeClick('user')}
                  render={
                    <IconButton aria-label={`${userFeedbackLabel}: ${likeLabel}`}>
                      <span aria-hidden="true" className="i-ri-thumb-up-line size-4" />
                    </IconButton>
                  }
                />
                <Toggle
                  className={destructivePressedClassName}
                  pressed={false}
                  onPressedChange={(pressed) => pressed && handleDislikeClick('user')}
                  render={
                    <IconButton aria-label={`${userFeedbackLabel}: ${dislikeLabel}`}>
                      <span aria-hidden="true" className="i-ri-thumb-down-line size-4" />
                    </IconButton>
                  }
                />
              </>
            )}
          </div>
        )}
        {shouldShowAdminFeedbackBar && !humanInputFormDataList?.length && (
          <div
            className={cn(
              'ml-1 items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs',
              hasAdminFeedback || hasUserFeedback ? 'flex' : `hidden ${answerActiveFlexClassName}`,
            )}
          >
            {displayUserFeedback?.rating && (
              <FeedbackTooltip
                content={buildFeedbackTooltip(displayUserFeedback, userFeedbackLabel)}
              >
                <span
                  role="img"
                  aria-label={buildFeedbackTooltip(displayUserFeedback, userFeedbackLabel)}
                  className={cn(
                    'inline-flex size-6 items-center justify-center rounded-lg p-0.5',
                    displayUserFeedback.rating === 'like'
                      ? 'bg-state-accent-active text-text-accent'
                      : 'bg-state-destructive-hover text-text-destructive',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-4',
                      displayUserFeedback.rating === 'like'
                        ? 'i-ri-thumb-up-line'
                        : 'i-ri-thumb-down-line',
                    )}
                  />
                </span>
              </FeedbackTooltip>
            )}

            {displayUserFeedback?.rating && (
              <div className="mx-1 h-3 w-[0.5px] bg-components-actionbar-border" />
            )}
            {hasAdminFeedback ? (
              <FeedbackTooltip
                content={buildFeedbackTooltip(displayAdminFeedback, adminFeedbackLabel)}
              >
                <Toggle
                  className={
                    displayAdminFeedback?.rating === 'like'
                      ? accentPressedClassName
                      : destructivePressedClassName
                  }
                  pressed
                  onPressedChange={(pressed) =>
                    !pressed && void handleFeedback(null, undefined, 'admin')
                  }
                  render={
                    <IconButton
                      aria-label={`${adminFeedbackLabel}: ${displayAdminFeedback?.rating === 'like' ? likeLabel : dislikeLabel}`}
                    >
                      {displayAdminFeedback?.rating === 'like' ? (
                        <span aria-hidden="true" className="i-ri-thumb-up-line size-4" />
                      ) : (
                        <span aria-hidden="true" className="i-ri-thumb-down-line size-4" />
                      )}
                    </IconButton>
                  }
                />
              </FeedbackTooltip>
            ) : (
              <>
                <FeedbackTooltip
                  content={buildFeedbackTooltip(displayAdminFeedback, adminFeedbackLabel)}
                >
                  <Toggle
                    className={accentPressedClassName}
                    pressed={false}
                    onPressedChange={(pressed) => pressed && handleLikeClick('admin')}
                    render={
                      <IconButton aria-label={`${adminFeedbackLabel}: ${likeLabel}`}>
                        <span aria-hidden="true" className="i-ri-thumb-up-line size-4" />
                      </IconButton>
                    }
                  />
                </FeedbackTooltip>
                <FeedbackTooltip
                  content={buildFeedbackTooltip(displayAdminFeedback, adminFeedbackLabel)}
                >
                  <Toggle
                    className={destructivePressedClassName}
                    pressed={false}
                    onPressedChange={(pressed) => pressed && handleDislikeClick('admin')}
                    render={
                      <IconButton aria-label={`${adminFeedbackLabel}: ${dislikeLabel}`}>
                        <span aria-hidden="true" className="i-ri-thumb-down-line size-4" />
                      </IconButton>
                    }
                  />
                </FeedbackTooltip>
              </>
            )}
          </div>
        )}
        {showPromptLog && !isOpeningStatement && (
          <div className={cn('hidden', answerActiveBlockClassName)}>
            <Log logItem={item} />
          </div>
        )}
        {!isOpeningStatement && (
          <div
            className={cn(
              'ml-1 hidden items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-xs',
              answerActiveFlexClassName,
            )}
            data-testid="operation-actions"
          >
            {config?.text_to_speech?.enabled &&
              hasPublicContent &&
              !humanInputFormDataList?.length && (
                <NewAudioButton id={id} value={content} voice={config?.text_to_speech?.voice} />
              )}
            {hasPublicContent && !humanInputFormDataList?.length && (
              <IconButton
                aria-label={copyLabel}
                onClick={() => {
                  copy(content)
                  toast.success(t(($) => $['actionMsg.copySuccessfully'], { ns: 'common' }))
                }}
              >
                <span aria-hidden="true" className="i-ri-clipboard-line size-4" />
              </IconButton>
            )}
            {(!noChatInput || showRegenerate) && (
              <IconButton aria-label={regenerateLabel} onClick={() => onRegenerate?.(item)}>
                <span aria-hidden="true" className="i-ri-reset-left-line size-4" />
              </IconButton>
            )}
            {shouldShowAnnotationAction && (
              <AnnotationCtrlButton
                appId={config?.appId || ''}
                messageId={id}
                cached={!!annotation?.id}
                query={question}
                answer={content}
                onAdded={(id, authorName) =>
                  onAnnotationAdded?.(id, authorName, question, content, index)
                }
                onEdit={() => setIsShowReplyModal(true)}
              />
            )}
          </div>
        )}
      </div>
      {canManageAnnotation && (
        <EditReplyModal
          isShow={isShowReplyModal}
          onHide={() => setIsShowReplyModal(false)}
          query={question}
          answer={content}
          onEdited={(editedQuery, editedAnswer) =>
            onAnnotationEdited?.(editedQuery, editedAnswer, index)
          }
          onAdded={(annotationId, authorName, editedQuery, editedAnswer) =>
            onAnnotationAdded?.(annotationId, authorName, editedQuery, editedAnswer, index)
          }
          appId={config?.appId || ''}
          messageId={id}
          annotationId={annotation?.id || ''}
          createdAt={annotation?.created_at}
          onRemove={() => onAnnotationRemoved?.(index)}
        />
      )}
      {isShowFeedbackModal && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) handleFeedbackCancel()
          }}
        >
          <DialogContent backdropProps={{ forceRender: true }} className="p-0">
            <div className="flex max-h-[80dvh] flex-col">
              <div className="relative shrink-0 p-6 pr-14 pb-3">
                <DialogTitle className="title-2xl-semi-bold text-text-primary">
                  {t(($) => $['feedback.title'], { ns: 'common' }) || 'Provide Feedback'}
                </DialogTitle>
                <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
                  {t(($) => $['feedback.subtitle'], { ns: 'common' }) ||
                    'Please tell us what went wrong with this response'}
                </DialogDescription>
                <DialogClose
                  render={
                    <IconButton
                      aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                      size="lg"
                      className="absolute top-5 right-5"
                    >
                      <span aria-hidden className="i-ri-close-line size-4" />
                    </IconButton>
                  }
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
                <label
                  htmlFor={feedbackTextareaId}
                  className="mb-2 block system-sm-semibold text-text-secondary"
                >
                  {t(($) => $['feedback.content'], { ns: 'common' }) || 'Feedback Content'}
                </label>
                <Textarea
                  id={feedbackTextareaId}
                  name="feedback-content"
                  value={feedbackContent}
                  onValueChange={(value) => setFeedbackContent(value)}
                  placeholder={
                    t(($) => $['feedback.placeholder'], { ns: 'common' }) ||
                    'Please describe what went wrong or how we can improve…'
                  }
                  rows={4}
                  className="w-full"
                />
              </div>
              <div className="flex shrink-0 justify-end p-6 pt-5">
                <Button onClick={handleFeedbackCancel}>
                  {t(($) => $['operation.cancel'], { ns: 'common' }) || 'Cancel'}
                </Button>
                <Button className="ml-2" variant="primary" onClick={handleFeedbackSubmit}>
                  {t(($) => $['operation.submit'], { ns: 'common' }) || 'Submit'}
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
