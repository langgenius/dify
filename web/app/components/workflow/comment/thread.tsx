'use client'

import type {
  WorkflowCommentDetail,
  WorkflowCommentReply,
} from '@dify/contracts/api/console/apps/types.gen'
import type { RefObject } from 'react'
import type { ThreadReply } from './pending-reply'
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
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import {
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
} from '@langgenius/dify-ui/popover'
import { Separator } from '@langgenius/dify-ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { skipToken, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { editorAppIdAtom } from '@/app/components/workflow/editor-resource/state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleQuery } from '@/service/console'
import { CollaboratorAvatar } from '../collaboration/components/collaborator-avatar'
import { CommentComposerFrame } from './comment-composer'
import { MentionInput } from './mention-input'
import { toCommentCollaborator } from './participants'
import { getReplyKey } from './pending-reply'
import {
  CommentMessage,
  CommentReplyBar,
  CommentThreadItem,
  CommentThreadList,
  CommentThreadPopup,
} from './thread-view'
import { useCommentHover } from './use-comment-hover'

const EMPTY_IDS: readonly string[] = []

type CommentThreadProps = {
  comment: Omit<WorkflowCommentDetail, 'replies'> & { replies: ThreadReply[] }
  loading?: boolean
  /** Why the thread's replies could not load, with a retry; the comment itself still shows. */
  loadError?: { message: string; onRetry: () => void }
  onDelete?: (commentId: string) => Promise<void> | void
  onResolve?: () => void
  onPrev?: () => void
  onNext?: () => void
  /** The comment and reply ids whose edit is being saved. */
  savingIds?: readonly string[]
  /** The comment and reply ids being deleted. */
  deletingIds?: readonly string[]
  onCommentEdit?: (content: string, mentionedUserIds?: string[]) => Promise<void> | void
  onReply?: (content: string, mentionedUserIds?: string[]) => Promise<void> | void
  onReplyEdit?: (
    replyId: string,
    content: string,
    mentionedUserIds?: string[],
  ) => Promise<void> | void
  onReplyDelete?: (replyId: string) => Promise<void> | void
  /** Sends a reply that failed to send again. */
  onReplyRetry?: (replyId: string) => void
  /** Drops a reply that failed to send. */
  onReplyDiscard?: (replyId: string) => void
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

  return (
    <CommentMessage
      author={toCommentCollaborator(
        author,
        t(($) => $['comments.fallback.user'], { ns: 'workflowComments' }),
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
  ...sessionProps
}: CommentThreadProps) {
  const { t } = useTranslation(['common', 'workflowComments'])
  const hover = useCommentHover()
  // The comment a delete confirmation belongs to. It stays open only while that
  // comment is the one shown, so deleting it and moving on closes the dialog.
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)
  const deletePending = !!sessionProps.deletingIds?.includes(comment.id)
  const replyInputRef = useRef<HTMLTextAreaElement>(null)

  const deleteLabel = t(($) => $['comments.aria.deleteComment'], { ns: 'workflowComments' })
  const resolveLabel = t(($) => $['comments.aria.resolveComment'], { ns: 'workflowComments' })
  const previousLabel = t(($) => $['comments.aria.previousComment'], { ns: 'workflowComments' })
  const nextLabel = t(($) => $['comments.aria.nextComment'], { ns: 'workflowComments' })

  return (
    <CommentThreadPopup
      initialFocus={sessionProps.onReply ? replyInputRef : undefined}
      {...hover}
      title={t(($) => $['comments.panelTitle'], { ns: 'workflowComments' })}
      closeLabel={t(($) => $['comments.aria.closeComment'], { ns: 'workflowComments' })}
      actions={
        // One tooltip serves every header button; each trigger passes its own label.
        <Tooltip>
          {({ payload }) => (
            <>
              <TooltipTrigger
                payload={deleteLabel}
                render={
                  <IconButton
                    size="lg"
                    tone="destructive"
                    aria-label={deleteLabel}
                    disabled={deletePending}
                    onClick={() => setDeletingCommentId(comment.id)}
                  >
                    <span aria-hidden className="i-ri-delete-bin-line size-4" />
                  </IconButton>
                }
              />
              <TooltipTrigger
                payload={resolveLabel}
                render={
                  <IconButton
                    size="lg"
                    aria-label={resolveLabel}
                    focusableWhenDisabled
                    disabled={comment.resolved}
                    onClick={onResolve}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'size-4',
                        comment.resolved
                          ? 'i-ri-checkbox-circle-fill'
                          : 'i-ri-checkbox-circle-line',
                      )}
                    />
                  </IconButton>
                }
              />
              <Separator orientation="vertical" className="mx-2 h-3.5" />
              <TooltipTrigger
                payload={previousLabel}
                render={
                  <IconButton
                    size="lg"
                    aria-label={previousLabel}
                    focusableWhenDisabled
                    disabled={!onPrev}
                    onClick={onPrev}
                  >
                    <span aria-hidden className="i-ri-arrow-up-s-line size-4" />
                  </IconButton>
                }
              />
              <TooltipTrigger
                payload={nextLabel}
                render={
                  <IconButton
                    size="lg"
                    aria-label={nextLabel}
                    focusableWhenDisabled
                    disabled={!onNext}
                    onClick={onNext}
                  >
                    <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
                  </IconButton>
                }
              />
              {typeof payload === 'string' && <TooltipContent>{payload}</TooltipContent>}
            </>
          )}
        </Tooltip>
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
          if (deletePending) eventDetails.cancel()
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
            <AlertDialogCancelButton disabled={deletePending}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={deletePending}
              onClick={() => {
                if (deletingCommentId) onDelete?.(deletingCommentId)
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
  | 'loadError'
  | 'onCommentEdit'
  | 'savingIds'
  | 'deletingIds'
  | 'onReply'
  | 'onReplyEdit'
  | 'onReplyDelete'
  | 'onReplyRetry'
  | 'onReplyDiscard'
> & {
  replyInputRef: RefObject<HTMLTextAreaElement | null>
}

/** One comment's thread body: its messages, the reply draft and reply deletion. */
function CommentThreadSession({
  comment,
  loading = false,
  loadError,
  replyInputRef,
  onCommentEdit,
  savingIds = EMPTY_IDS,
  deletingIds = EMPTY_IDS,
  onReply,
  onReplyEdit,
  onReplyDelete,
  onReplyRetry,
  onReplyDiscard,
}: CommentThreadSessionProps) {
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const currentUserId = userProfile.id
  const { t } = useTranslation(['common', 'workflowComments'])
  const [replyContent, setReplyContent] = useState('')
  const messageListRef = useRef<HTMLDivElement>(null)
  const previousReplyCountRef = useRef<number | undefined>(undefined)
  // Whether the reader is at the newest message: they leave it only by scrolling up, so a
  // scroll this list makes toward a new reply keeps following.
  const atNewestRef = useRef(true)
  const lastScrollTopRef = useRef(0)
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

  const appId = useAtomValue(editorAppIdAtom)
  const { data: mentionUsers } = useQuery(
    consoleQuery.apps.byAppId.workflow.comments.mentionUsers.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
      select: (response) => response.users,
    }),
  )
  const mentionNames = useMemo(
    () => (mentionUsers ?? []).map((user) => user.name ?? ''),
    [mentionUsers],
  )

  const replies = comment.replies || []
  // A send from here, new or sent again, is one this list has not seen sending before; a
  // send that finishes is not. Joined, the keys compare by value between renders.
  const sendingKeys = replies
    .filter((reply) => reply.send_state === 'pending')
    .map((reply) => reply.client_key)
    .join(' ')
  const seenSendingKeysRef = useRef(new Set(sendingKeys.split(' ')))

  useEffect(() => {
    const container = messageListRef.current
    // Opening, including a first load of the thread, lands on the newest message at once.
    // Later, a reply sent from here scrolls into view, and so does one from someone else when
    // the reader is at the newest message; someone reading earlier messages keeps their place.
    if (!container || loading) return

    const previousReplyCount = previousReplyCountRef.current
    if (previousReplyCount === undefined)
      container.scrollTo({ top: container.scrollHeight, behavior: 'instant' })
    else if (
      sendingKeys.split(' ').some((key) => key && !seenSendingKeysRef.current.has(key)) ||
      (replies.length > previousReplyCount && atNewestRef.current)
    ) {
      // Heading to the newest message, so the next reply follows too.
      atNewestRef.current = true
      container.scrollTo({
        top: container.scrollHeight,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      })
    }

    previousReplyCountRef.current = replies.length
    for (const key of sendingKeys.split(' ')) seenSendingKeysRef.current.add(key)
  }, [loading, replies.length, sendingKeys])

  // The reply shows in the thread at once, so the box clears for the next one. A reply
  // that fails to send stays in the thread with its own retry.
  const handleReplySubmit = (content: string, mentionedUserIds: string[]) => {
    if (!onReply) return
    setReplyContent('')
    void onReply(content, mentionedUserIds)
  }

  return (
    <>
      <CommentThreadList
        ref={messageListRef}
        aria-busy={loading || undefined}
        onScroll={(event) => {
          const list = event.currentTarget
          if (list.scrollHeight - list.scrollTop - list.clientHeight < 24)
            atNewestRef.current = true
          else if (list.scrollTop < lastScrollTopRef.current) atNewestRef.current = false
          lastScrollTopRef.current = list.scrollTop
        }}
      >
        <CommentThreadEntry
          account={comment.created_by_account}
          createdAt={comment.created_at ?? comment.updated_at ?? 0}
          content={comment.content}
          mentionNames={mentionNames}
          isOwn={comment.created_by_account?.id === currentUserId}
          actionsLabel={t(($) => $['comments.aria.commentActions'], { ns: 'workflowComments' })}
          editLabel={t(($) => $['comments.actions.editComment'], { ns: 'workflowComments' })}
          editPlaceholder={t(($) => $['comments.placeholder.editComment'], {
            ns: 'workflowComments',
          })}
          onSave={onCommentEdit}
          saving={savingIds.includes(comment.id)}
          onEditEnd={focusReply}
        />
        {replies.map((reply) =>
          reply.send_state ? (
            <UnsentReplyEntry
              key={getReplyKey(reply)}
              reply={reply}
              mentionNames={mentionNames}
              onRetry={
                onReplyRetry &&
                (() => {
                  onReplyRetry(reply.id)
                  focusReply()
                })
              }
              onDiscard={
                onReplyDiscard &&
                (() => {
                  onReplyDiscard(reply.id)
                  focusReply()
                })
              }
            />
          ) : (
            <CommentThreadEntry
              key={getReplyKey(reply)}
              account={reply.created_by_account}
              createdAt={reply.created_at ?? 0}
              content={reply.content}
              mentionNames={mentionNames}
              isOwn={reply.created_by_account?.id === currentUserId}
              actionsLabel={t(($) => $['comments.aria.replyActions'], { ns: 'workflowComments' })}
              editLabel={t(($) => $['comments.actions.editReply'], { ns: 'workflowComments' })}
              editPlaceholder={t(($) => $['comments.placeholder.editReply'], {
                ns: 'workflowComments',
              })}
              onSave={onReplyEdit && ((content, ids) => onReplyEdit(reply.id, content, ids))}
              saving={savingIds.includes(reply.id)}
              deleting={deletingIds.includes(reply.id)}
              onEditEnd={focusReply}
              deleteLabel={t(($) => $['comments.actions.deleteReply'], { ns: 'workflowComments' })}
              deleteConfirmLabel={t(($) => $['comments.confirm.deleteReplyTitle'], {
                ns: 'workflowComments',
              })}
              onDelete={
                onReplyDelete &&
                (async () => {
                  await onReplyDelete(reply.id)
                  // The deleted row takes its menu with it, so focus moves on to the reply box.
                  focusReply()
                })
              }
            />
          ),
        )}
        {loadError && (
          <div
            role="alert"
            className="flex items-center gap-1 px-3 py-1 system-xs-regular text-text-destructive"
          >
            <span className="min-w-0 wrap-break-word">{loadError.message}</span>
            <Button size="small" variant="ghost" onClick={loadError.onRetry}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </div>
        )}
      </CommentThreadList>
      {onReply && (
        <CommentReplyBar
          author={toCommentCollaborator(
            userProfile,
            t(($) => $.you, { ns: 'common' }),
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
          />
        </CommentReplyBar>
      )}
    </>
  )
}

type CommentThreadEntryProps = {
  account: WorkflowCommentReply['created_by_account']
  createdAt: number
  content: string
  mentionNames: string[]
  isOwn: boolean
  actionsLabel: string
  editLabel: string
  editPlaceholder: string
  onSave?: (content: string, mentionedUserIds: string[]) => Promise<void> | void
  /** An edit of this message is being saved; its field stays locked until it is. */
  saving?: boolean
  /** This message is being deleted; its confirmation stays open until it is. */
  deleting?: boolean
  /** Called after an edit is saved or cancelled. */
  onEditEnd: () => void
  deleteLabel?: string
  /** Asked beside the actions button before onDelete runs. */
  deleteConfirmLabel?: string
  onDelete?: () => Promise<void> | void
}

/** One message in a thread. Its author gets an actions menu with Edit and, for replies, Delete. */
function CommentThreadEntry({
  account,
  createdAt,
  content,
  mentionNames,
  isOwn,
  actionsLabel,
  editLabel,
  editPlaceholder,
  onSave,
  saving = false,
  deleting = false,
  onEditEnd,
  deleteLabel,
  deleteConfirmLabel,
  onDelete,
}: CommentThreadEntryProps) {
  const { t } = useTranslation(['common', 'workflowComments'])
  const [draft, setDraft] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)
  const editing = draft !== null

  const endEdit = () => {
    setDraft(null)
    onEditEnd()
  }

  const handleSave = async (value: string, mentionedUserIds: string[]) => {
    const trimmed = value.trim()
    if (!onSave || !trimmed || saving) return
    try {
      await onSave(trimmed, mentionedUserIds)
      endEdit()
    } catch (error) {
      console.error('Failed to save comment edit', error)
    }
  }

  return (
    <CommentThreadItem>
      {isOwn && (
        // The menu stays mounted while editing, so choosing Edit can finish closing it into
        // the edit field; only its button is hidden.
        <Menu>
          <MenuTrigger
            ref={menuTriggerRef}
            hidden={editing}
            data-confirming={confirmingDelete || undefined}
            className="absolute inset-e-2 top-2 flex size-6 items-center justify-center rounded-md text-text-tertiary opacity-0 group-hover:opacity-100 hover:bg-state-base-hover hover:text-text-secondary focus:opacity-100 data-confirming:opacity-100 data-popup-open:opacity-100 [@media(hover:none)]:opacity-100"
            aria-label={actionsLabel}
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </MenuTrigger>
          <MenuContent
            align="end"
            className="w-36 backdrop-blur-[10px]"
            // Choosing Edit closes the menu into the edit field, with the caret at the end of
            // its text; otherwise focus returns to the actions button.
            finalFocus={
              confirmingDelete
                ? false
                : () => {
                    const editor = editorRef.current
                    if (!editor) return true
                    editor.setSelectionRange(editor.value.length, editor.value.length)
                    return editor
                  }
            }
          >
            <MenuItem className="px-3" disabled={!onSave} onClick={() => setDraft(content)}>
              {editLabel}
            </MenuItem>
            {onDelete && (
              <MenuItem
                className="px-3"
                variant="destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                {deleteLabel}
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
      )}
      {onDelete && (
        <Popover
          open={confirmingDelete}
          onOpenChange={(open, eventDetails) => {
            if (!open && deleting) eventDetails.cancel()
            else setConfirmingDelete(open)
          }}
        >
          <PopoverPortal>
            <PopoverPositioner anchor={menuTriggerRef} side="bottom" align="end" sideOffset={4}>
              <PopoverPopup
                initialFocus={cancelDeleteRef}
                finalFocus={menuTriggerRef}
                className="flex w-36 flex-col gap-1.5 rounded-[10px] border-[0.5px] border-components-panel-border-subtle bg-components-panel-bg-blur px-2 pt-1.5 pb-2 shadow-lg backdrop-blur-[5px] transition-none"
              >
                <PopoverTitle className="system-sm-semibold text-text-primary">
                  {deleteConfirmLabel}
                </PopoverTitle>
                <div className="flex gap-1">
                  <PopoverClose
                    ref={cancelDeleteRef}
                    render={<Button size="small" variant="secondary" className="flex-1" />}
                  >
                    {t(($) => $['operation.cancel'], { ns: 'common' })}
                  </PopoverClose>
                  <Button
                    size="small"
                    variant="primary"
                    tone="destructive"
                    className="flex-1"
                    loading={deleting}
                    onClick={() => onDelete()}
                  >
                    {t(($) => $['operation.delete'], { ns: 'common' })}
                  </Button>
                </div>
              </PopoverPopup>
            </PopoverPositioner>
          </PopoverPortal>
        </Popover>
      )}
      {editing ? (
        <div className="flex gap-3">
          <CollaboratorAvatar
            size="sm"
            className="shrink-0"
            collaborator={toCommentCollaborator(
              account,
              t(($) => $['comments.fallback.user'], { ns: 'workflowComments' }),
            )}
          />
          <div className="min-w-0 flex-1">
            <CommentComposerFrame>
              <MentionInput
                ref={editorRef}
                value={draft}
                onChange={setDraft}
                onSubmit={handleSave}
                onCancel={endEdit}
                placeholder={editPlaceholder}
                loading={saving}
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

type UnsentReplyEntryProps = {
  reply: ThreadReply
  mentionNames: string[]
  onRetry?: () => void
  onDiscard?: () => void
}

/**
 * A reply the server does not have yet. While sending it looks like any other reply, marked
 * busy for assistive technology; if sending failed it says so and offers to send it again or
 * drop it.
 */
function UnsentReplyEntry({ reply, mentionNames, onRetry, onDiscard }: UnsentReplyEntryProps) {
  const { t } = useTranslation(['common', 'workflowComments'])
  const failed = reply.send_state === 'failed'
  return (
    <CommentThreadItem aria-busy={!failed || undefined}>
      <ThreadMessage
        author={reply.created_by_account}
        createdAt={reply.created_at ?? 0}
        content={reply.content}
        mentionNames={mentionNames}
      />
      {failed && (
        <div className="mt-1 flex items-center gap-2 ps-9 system-xs-regular">
          <span className="text-text-destructive">
            {t(($) => $['comments.status.notSent'], { ns: 'workflowComments' })}
          </span>
          {onRetry && (
            <button
              type="button"
              className="system-xs-medium text-text-accent hover:underline"
              onClick={onRetry}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </button>
          )}
          {onDiscard && (
            <button
              type="button"
              className="system-xs-medium text-text-tertiary hover:underline"
              onClick={onDiscard}
            >
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </button>
          )}
        </div>
      )}
    </CommentThreadItem>
  )
}
