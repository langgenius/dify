'use client'

import type {
  WorkflowCommentDetail,
  WorkflowCommentReply,
} from '@dify/contracts/api/console/apps/types.gen'
import type { RefObject } from 'react'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { Separator } from '@langgenius/dify-ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { editorAppIdAtom } from '@/app/components/workflow/editor-resource/state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { CollaboratorAvatar } from '../collaboration/components/collaborator-avatar'
import { useStore } from '../store'
import { CommentComposerFrame } from './comment-composer'
import { MentionInput } from './mention-input'
import { toCommentCollaborator } from './participants'
import {
  CommentMessage,
  CommentReplyBar,
  CommentThreadItem,
  CommentThreadList,
  CommentThreadPopup,
} from './thread-view'

type CommentThreadProps = {
  comment: WorkflowCommentDetail
  loading?: boolean
  replySubmitting?: boolean
  replyUpdating?: boolean
  onDelete?: (commentId: string) => Promise<void> | void
  onResolve?: () => void
  onPrev?: () => void
  onNext?: () => void
  canGoPrev?: boolean
  canGoNext?: boolean
  onCommentEdit?: (content: string, mentionedUserIds?: string[]) => Promise<void> | void
  onReply?: (content: string, mentionedUserIds?: string[]) => Promise<void> | void
  onReplyEdit?: (
    replyId: string,
    content: string,
    mentionedUserIds?: string[],
  ) => Promise<void> | void
  onReplyDelete?: (replyId: string) => Promise<void> | void
}

type ThreadMessageProps = {
  author: WorkflowCommentReply['created_by_account']
  createdAt: number
  content: string
  mentionNames: string[]
}

function ThreadMessage({ author, createdAt, content, mentionNames }: ThreadMessageProps) {
  const { t } = useTranslation(['workflowComments'])
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })

  return (
    <CommentMessage
      author={toCommentCollaborator(
        {
          id: author?.id ?? '',
          name: author?.name || t(($) => $['comments.fallback.user'], { ns: 'workflowComments' }),
          avatar_url: author?.avatar_url ?? null,
        },
        currentUserId,
      )}
      timeLabel={formatTimeFromNow(createdAt * 1000)}
      content={content}
      mentionNames={mentionNames}
    />
  )
}

/**
 * The open comment's thread popup. Render it in the canvas's comment thread
 * `Popover`: the header (delete, resolve, previous, next, close) lasts as long
 * as the popup, and each comment gets a fresh session for its drafts and menus.
 */
export function CommentThread({
  comment,
  loading = false,
  onDelete,
  onResolve,
  onPrev,
  onNext,
  canGoPrev,
  canGoNext,
  ...sessionProps
}: CommentThreadProps) {
  const { t } = useTranslation(['common', 'workflowComments'])
  const setCommentPreviewHovering = useStore((state) => state.setCommentPreviewHovering)
  // The comment a delete confirmation belongs to. It stays open only while that
  // comment is the one shown, so deleting it and moving on closes the dialog.
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)
  const replyInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(
    () => () => {
      setCommentPreviewHovering(false)
    },
    [setCommentPreviewHovering],
  )

  return (
    <CommentThreadPopup
      // The reply box is disabled while the thread loads; then the popup's default target takes focus.
      initialFocus={() => {
        const reply = replyInputRef.current
        return reply && !reply.disabled ? reply : true
      }}
      onMouseEnter={() => setCommentPreviewHovering(true)}
      onMouseLeave={() => setCommentPreviewHovering(false)}
      title={t(($) => $['comments.panelTitle'], { ns: 'workflowComments' })}
      closeLabel={t(($) => $['comments.aria.closeComment'], { ns: 'workflowComments' })}
      loadingLabel={
        loading ? t(($) => $['comments.loading'], { ns: 'workflowComments' }) : undefined
      }
      actions={
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  disabled={loading}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled',
                  )}
                  onClick={() => setDeletingCommentId(comment.id)}
                  aria-label={t(($) => $['comments.aria.deleteComment'], {
                    ns: 'workflowComments',
                  })}
                >
                  <span aria-hidden className="i-ri-delete-bin-line size-4" />
                </button>
              }
            />
            <TooltipContent>
              {t(($) => $['comments.aria.deleteComment'], { ns: 'workflowComments' })}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  disabled={comment.resolved || loading}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled',
                  )}
                  onClick={onResolve}
                  aria-label={t(($) => $['comments.aria.resolveComment'], {
                    ns: 'workflowComments',
                  })}
                >
                  {comment.resolved ? (
                    <span aria-hidden className="i-ri-checkbox-circle-fill size-4" />
                  ) : (
                    <span aria-hidden className="i-ri-checkbox-circle-line size-4" />
                  )}
                </button>
              }
            />
            <TooltipContent>
              {t(($) => $['comments.aria.resolveComment'], { ns: 'workflowComments' })}
            </TooltipContent>
          </Tooltip>
          <Separator orientation="vertical" className="mx-2 h-3.5" />
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  disabled={!canGoPrev || loading}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled',
                  )}
                  onClick={onPrev}
                  aria-label={t(($) => $['comments.aria.previousComment'], {
                    ns: 'workflowComments',
                  })}
                >
                  <span aria-hidden className="i-ri-arrow-up-s-line size-4" />
                </button>
              }
            />
            <TooltipContent>
              {t(($) => $['comments.aria.previousComment'], { ns: 'workflowComments' })}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  disabled={!canGoNext || loading}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled',
                  )}
                  onClick={onNext}
                  aria-label={t(($) => $['comments.aria.nextComment'], {
                    ns: 'workflowComments',
                  })}
                >
                  <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
                </button>
              }
            />
            <TooltipContent>
              {t(($) => $['comments.aria.nextComment'], { ns: 'workflowComments' })}
            </TooltipContent>
          </Tooltip>
        </>
      }
    >
      <CommentThreadSession
        key={comment.id}
        comment={comment}
        loading={loading}
        replyInputRef={replyInputRef}
        {...sessionProps}
      />
      <AlertDialog
        open={deletingCommentId === comment.id}
        onOpenChange={(open, eventDetails) => {
          if (open) return
          if (loading) eventDetails.cancel()
          else setDeletingCommentId(null)
        }}
        onOpenChangeComplete={(open) => {
          if (!open) setDeletingCommentId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['comments.confirm.deleteThreadTitle'], { ns: 'workflowComments' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['comments.confirm.deleteThreadDesc'], { ns: 'workflowComments' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={loading}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={loading}
              onClick={() => {
                if (deletingCommentId) return onDelete?.(deletingCommentId)
              }}
            >
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CommentThreadPopup>
  )
}

type CommentThreadSessionProps = Pick<
  CommentThreadProps,
  | 'comment'
  | 'loading'
  | 'replySubmitting'
  | 'replyUpdating'
  | 'onCommentEdit'
  | 'onReply'
  | 'onReplyEdit'
  | 'onReplyDelete'
> & {
  replyInputRef: RefObject<HTMLTextAreaElement | null>
}

/** One comment's thread body: its messages, the reply draft and reply deletion. */
function CommentThreadSession({
  comment,
  loading = false,
  replySubmitting = false,
  replyUpdating = false,
  replyInputRef,
  onCommentEdit,
  onReply,
  onReplyEdit,
  onReplyDelete,
}: CommentThreadSessionProps) {
  const appId = useAtomValue(editorAppIdAtom)
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const currentUserId = userProfile.id
  const { t } = useTranslation(['common', 'workflowComments'])
  const [replyContent, setReplyContent] = useState('')
  // Reply deletion: the confirmation stays open until the user cancels or the reply is gone.
  const [deletingReply, setDeletingReply] = useState<{ id: string; cancelled: boolean } | null>(
    null,
  )
  const messageListRef = useRef<HTMLDivElement>(null)
  const previousReplyCountRef = useRef<number | undefined>(undefined)
  // This session's own reply box; the shared ref also lets the popup focus it on open.
  const ownReplyInputRef = useRef<HTMLTextAreaElement | null>(null)
  const attachReplyInput = useCallback(
    (textarea: HTMLTextAreaElement | null) => {
      ownReplyInputRef.current = textarea
      replyInputRef.current = textarea
    },
    [replyInputRef],
  )
  const focusReply = () => ownReplyInputRef.current?.focus()

  const mentionUsers = useStore((state) => (appId ? state.mentionableUsersCache[appId] : undefined))
  const mentionNames = useMemo(
    () =>
      Array.from(
        new Set((mentionUsers ?? []).map((user) => user.name?.trim()).filter(Boolean)),
      ) as string[],
    [mentionUsers],
  )

  const replies = comment.replies || []
  const deletedReplyGone =
    deletingReply !== null && !replies.some((reply) => reply.id === deletingReply.id)

  // Scroll to the newest message when the session opens and when a reply arrives.
  useEffect(() => {
    const container = messageListRef.current
    if (!container) return

    const previousReplyCount = previousReplyCountRef.current
    if (previousReplyCount === undefined || replies.length > previousReplyCount)
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })

    previousReplyCountRef.current = replies.length
  }, [replies.length])

  const handleReplySubmit = async (content: string, mentionedUserIds: string[]) => {
    if (!onReply || replySubmitting) return
    setReplyContent('')
    try {
      await onReply(content, mentionedUserIds)
    } catch (error) {
      console.error('Failed to send reply', error)
      setReplyContent(content)
    }
  }

  return (
    <>
      <CommentThreadList ref={messageListRef}>
        <CommentThreadEntry
          account={comment.created_by_account}
          createdAt={comment.created_at ?? comment.updated_at ?? 0}
          content={comment.content}
          mentionNames={mentionNames}
          isOwn={comment.created_by_account?.id === currentUserId}
          disabled={loading}
          actionsLabel={t(($) => $['comments.aria.commentActions'], { ns: 'workflowComments' })}
          editLabel={t(($) => $['comments.actions.editComment'], { ns: 'workflowComments' })}
          editPlaceholder={t(($) => $['comments.placeholder.editComment'], {
            ns: 'workflowComments',
          })}
          onSave={onCommentEdit}
          onEditEnd={focusReply}
        />
        {replies.map((reply) => (
          <CommentThreadEntry
            key={reply.id}
            account={reply.created_by_account}
            createdAt={reply.created_at ?? 0}
            content={reply.content}
            mentionNames={mentionNames}
            isOwn={reply.created_by_account?.id === currentUserId}
            disabled={loading}
            saving={replyUpdating}
            actionsLabel={t(($) => $['comments.aria.replyActions'], { ns: 'workflowComments' })}
            editLabel={t(($) => $['comments.actions.editReply'], { ns: 'workflowComments' })}
            editPlaceholder={t(($) => $['comments.placeholder.editReply'], {
              ns: 'workflowComments',
            })}
            onSave={onReplyEdit && ((content, ids) => onReplyEdit(reply.id, content, ids))}
            onEditEnd={focusReply}
            deleteLabel={t(($) => $['comments.actions.deleteReply'], { ns: 'workflowComments' })}
            onDelete={onReplyDelete && (() => setDeletingReply({ id: reply.id, cancelled: false }))}
          />
        ))}
      </CommentThreadList>
      {onReply && (
        <CommentReplyBar
          author={toCommentCollaborator(
            {
              id: currentUserId,
              name: userProfile?.name || t(($) => $.you, { ns: 'common' }),
              avatar_url: userProfile?.avatar_url ?? null,
            },
            currentUserId,
          )}
        >
          <MentionInput
            ref={attachReplyInput}
            value={replyContent}
            onChange={setReplyContent}
            onSubmit={handleReplySubmit}
            placeholder={t(($) => $['comments.placeholder.reply'], {
              ns: 'workflowComments',
            })}
            disabled={loading}
            loading={replySubmitting}
          />
        </CommentReplyBar>
      )}
      <AlertDialog
        open={deletingReply !== null && !deletingReply.cancelled && !deletedReplyGone}
        onOpenChange={(open, eventDetails) => {
          if (open) return
          if (loading) eventDetails.cancel()
          else setDeletingReply((current) => current && { ...current, cancelled: true })
        }}
        onOpenChangeComplete={(open) => {
          if (!open) setDeletingReply(null)
        }}
      >
        {/* Once the reply is gone its row and menu are too, so focus goes to the reply box. */}
        <AlertDialogContent finalFocus={deletedReplyGone ? ownReplyInputRef : undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['comments.confirm.deleteReplyTitle'], { ns: 'workflowComments' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['comments.confirm.deleteReplyDesc'], { ns: 'workflowComments' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={loading}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={loading}
              onClick={() => {
                if (deletingReply) return onReplyDelete?.(deletingReply.id)
              }}
            >
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

type CommentThreadEntryProps = {
  account: WorkflowCommentReply['created_by_account']
  createdAt: number
  content: string
  mentionNames: string[]
  isOwn: boolean
  disabled: boolean
  saving?: boolean
  actionsLabel: string
  editLabel: string
  editPlaceholder: string
  onSave?: (content: string, mentionedUserIds: string[]) => Promise<void> | void
  /** Called after an edit is saved or cancelled. */
  onEditEnd: () => void
  deleteLabel?: string
  onDelete?: () => void
}

/** One message in a thread. Its author gets an actions menu with Edit and, for replies, Delete. */
function CommentThreadEntry({
  account,
  createdAt,
  content,
  mentionNames,
  isOwn,
  disabled,
  saving = false,
  actionsLabel,
  editLabel,
  editPlaceholder,
  onSave,
  onEditEnd,
  deleteLabel,
  onDelete,
}: CommentThreadEntryProps) {
  const { t } = useTranslation(['workflowComments'])
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const [draft, setDraft] = useState<string | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const editing = draft !== null

  const endEdit = () => {
    setDraft(null)
    onEditEnd()
  }

  const handleSave = async (value: string, mentionedUserIds: string[]) => {
    const trimmed = value.trim()
    if (!onSave || !trimmed) return
    setSavingDraft(true)
    try {
      await onSave(trimmed, mentionedUserIds)
      endEdit()
    } catch (error) {
      console.error('Failed to save comment edit', error)
    } finally {
      setSavingDraft(false)
    }
  }

  return (
    <CommentThreadItem>
      {isOwn && !editing && (
        <Menu>
          <MenuTrigger
            className="absolute inset-e-2 top-2 flex size-6 items-center justify-center rounded-md text-text-tertiary opacity-0 group-hover:opacity-100 hover:bg-state-base-hover hover:text-text-secondary focus:opacity-100 data-popup-open:opacity-100 [@media(hover:none)]:opacity-100"
            aria-label={actionsLabel}
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </MenuTrigger>
          <MenuContent align="end" className="w-36 backdrop-blur-[10px]">
            <MenuItem className="px-3" disabled={!onSave} onClick={() => setDraft(content)}>
              {editLabel}
            </MenuItem>
            {onDelete && (
              <MenuItem className="px-3" variant="destructive" onClick={onDelete}>
                {deleteLabel}
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
      )}
      {editing ? (
        <div className="flex gap-3">
          <CollaboratorAvatar
            size="sm"
            className="shrink-0"
            collaborator={toCommentCollaborator(
              {
                id: account?.id ?? '',
                name:
                  account?.name ||
                  t(($) => $['comments.fallback.user'], { ns: 'workflowComments' }),
                avatar_url: account?.avatar_url ?? null,
              },
              currentUserId,
            )}
          />
          <div className="min-w-0 flex-1">
            <CommentComposerFrame>
              <MentionInput
                ref={focusAtEnd}
                value={draft}
                onChange={setDraft}
                onSubmit={handleSave}
                onCancel={endEdit}
                placeholder={editPlaceholder}
                disabled={disabled}
                loading={saving || savingDraft}
                isEditing
              />
            </CommentComposerFrame>
          </div>
        </div>
      ) : (
        <ThreadMessage
          author={account}
          createdAt={createdAt}
          content={content}
          mentionNames={mentionNames}
        />
      )}
    </CommentThreadItem>
  )
}

// An edit field opens focused with its text ready to extend. The menu that started the
// edit returns focus in a microtask as it closes; queueing after it lets the field win.
function focusAtEnd(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return
  queueMicrotask(() => {
    if (!textarea.isConnected) return
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  })
}
