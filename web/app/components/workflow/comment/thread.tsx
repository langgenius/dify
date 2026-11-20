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
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCheckboxCircleFill,
  RiCheckboxCircleLine,
  RiDeleteBinLine,
  RiMoreFill,
} from '@remixicon/react'
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
  onDelete?: () => Promise<void> | void
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
  const [confirmingDelete, setConfirmingDelete] = useState(false)
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
                  onClick={() => setConfirmingDelete(true)}
                  aria-label={t(($) => $['comments.aria.deleteComment'], {
                    ns: 'workflowComments',
                  })}
                >
                  <RiDeleteBinLine className="size-4" />
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
                    <RiCheckboxCircleFill className="size-4" />
                  ) : (
                    <RiCheckboxCircleLine className="size-4" />
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
                  <RiArrowUpSLine className="size-4" />
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
                  <RiArrowDownSLine className="size-4" />
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
        open={confirmingDelete}
        onOpenChange={(open, eventDetails) => {
          if (!open && loading) {
            eventDetails.cancel()
            return
          }
          setConfirmingDelete(open)
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
            <AlertDialogConfirmButton loading={loading} onClick={() => onDelete?.()}>
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
  const [editingCommentContent, setEditingCommentContent] = useState('')
  const [activeReplyMenuId, setActiveReplyMenuId] = useState<string | null>(null)
  const [editingReply, setEditingReply] = useState<{ id: string; content: string }>({
    id: '',
    content: '',
  })
  const [deletingReplyId, setDeletingReplyId] = useState<string | null>(null)
  const [isCommentEditing, setIsCommentEditing] = useState(false)
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)

  // Get mentionable users from store
  const mentionUsersFromStore = useStore((state) =>
    appId ? state.mentionableUsersCache[appId] : undefined,
  )
  const mentionUsers = mentionUsersFromStore ?? []

  // Extract all mentionable names for highlighting
  const mentionableNames = useMemo(() => {
    const names = mentionUsers
      .map((user) => user.name?.trim())
      .filter((name): name is string => Boolean(name))
    return Array.from(new Set(names))
  }, [mentionUsers])

  const handleReplySubmit = useCallback(
    async (content: string, mentionedUserIds: string[]) => {
      if (!onReply || replySubmitting) return

      setReplyContent('')

      try {
        await onReply(content, mentionedUserIds)

        // P0: Restore focus to reply input after successful submission
        setTimeout(() => {
          replyInputRef.current?.focus()
        }, 0)
      } catch (error) {
        console.error('Failed to send reply', error)
        setReplyContent(content)
      }
    },
    [onReply, replyInputRef, replySubmitting],
  )

  const handleStartEdit = useCallback((reply: WorkflowCommentReply) => {
    setEditingReply({ id: reply.id, content: reply.content })
    setIsCommentEditing(false)
    setActiveReplyMenuId(null)
  }, [])

  const handleStartCommentEdit = useCallback(() => {
    setEditingCommentContent(comment.content)
    setEditingReply({ id: '', content: '' })
    setIsCommentEditing(true)
    setActiveReplyMenuId(null)
  }, [comment.content])

  const handleCancelEdit = useCallback(() => {
    setEditingReply({ id: '', content: '' })

    // P1: Restore focus to reply input after canceling edit
    setTimeout(() => {
      replyInputRef.current?.focus()
    }, 0)
  }, [replyInputRef])

  const handleCancelCommentEdit = useCallback(() => {
    setEditingCommentContent('')
    setIsCommentEditing(false)

    setTimeout(() => {
      replyInputRef.current?.focus()
    }, 0)
  }, [replyInputRef])

  const handleCommentEditSubmit = useCallback(
    async (content: string, mentionedUserIds: string[]) => {
      if (!onCommentEdit) return
      const trimmed = content.trim()
      if (!trimmed) return

      setIsSubmittingEdit(true)
      try {
        await onCommentEdit(trimmed, mentionedUserIds)
        setEditingCommentContent('')
        setIsCommentEditing(false)

        setTimeout(() => {
          replyInputRef.current?.focus()
        }, 0)
      } catch (error) {
        console.error('Failed to edit comment', error)
      } finally {
        setIsSubmittingEdit(false)
      }
    },
    [onCommentEdit, replyInputRef],
  )

  const handleEditSubmit = useCallback(
    async (content: string, mentionedUserIds: string[]) => {
      if (!onReplyEdit || !editingReply) return
      const trimmed = content.trim()
      if (!trimmed) return

      setIsSubmittingEdit(true)
      try {
        await onReplyEdit(editingReply.id, trimmed, mentionedUserIds)
        setEditingReply({ id: '', content: '' })

        // P1: Restore focus to reply input after saving edit
        setTimeout(() => {
          replyInputRef.current?.focus()
        }, 0)
      } catch (error) {
        console.error('Failed to edit reply', error)
      } finally {
        setIsSubmittingEdit(false)
      }
    },
    [editingReply, onReplyEdit, replyInputRef],
  )

  const replies = comment.replies || []
  const replyWasDeleted =
    deletingReplyId !== null && !loading && !replies.some((reply) => reply.id === deletingReplyId)
  const isOwnComment = comment.created_by_account?.id === currentUserId
  const messageListRef = useRef<HTMLDivElement>(null)
  // Choosing "Edit" unmounts the row menu; the edit field takes focus as it mounts, so that
  // menu must not hand focus back to the marker it falls back to.
  const editOpeningRef = useRef(false)
  const menuFinalFocus = () => !editOpeningRef.current
  const attachEditField = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return
    editOpeningRef.current = false
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [])
  const previousReplyCountRef = useRef<number | undefined>(undefined)

  // Close menu when scrolling
  useEffect(() => {
    const container = messageListRef.current
    if (!container || !activeReplyMenuId) return

    const handleScroll = () => {
      setActiveReplyMenuId(null)
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [activeReplyMenuId])

  // Scroll to the newest message when the session opens and when a reply arrives.
  useEffect(() => {
    const container = messageListRef.current
    if (!container) return

    const previousReplyCount = previousReplyCountRef.current
    if (previousReplyCount === undefined || replies.length > previousReplyCount)
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })

    previousReplyCountRef.current = replies.length
  }, [replies.length])

  return (
    <>
      <CommentThreadList ref={messageListRef}>
        <CommentThreadItem>
          {isOwnComment && !isCommentEditing && (
            <Menu
              open={activeReplyMenuId === comment.id}
              onOpenChange={(open) => setActiveReplyMenuId(open ? comment.id : null)}
            >
              <MenuTrigger
                className="absolute inset-e-2 top-2 flex size-6 items-center justify-center rounded-md text-text-tertiary opacity-0 group-hover:opacity-100 hover:bg-state-base-hover hover:text-text-secondary focus:opacity-100 data-popup-open:opacity-100 [@media(hover:none)]:opacity-100"
                aria-label={t(($) => $['comments.aria.commentActions'], {
                  ns: 'workflowComments',
                })}
              >
                <RiMoreFill className="size-4" />
              </MenuTrigger>
              <MenuContent
                align="end"
                className="w-36 backdrop-blur-[10px]"
                finalFocus={menuFinalFocus}
              >
                <MenuItem
                  className="px-3"
                  onClick={(e) => {
                    e.stopPropagation()
                    editOpeningRef.current = true
                    handleStartCommentEdit()
                  }}
                >
                  {t(($) => $['comments.actions.editComment'], { ns: 'workflowComments' })}
                </MenuItem>
              </MenuContent>
            </Menu>
          )}
          {isCommentEditing ? (
            <div className="flex gap-3">
              <CollaboratorAvatar
                size="sm"
                className="shrink-0"
                collaborator={toCommentCollaborator(
                  {
                    id: comment.created_by_account?.id ?? '',
                    name:
                      comment.created_by_account?.name ||
                      t(($) => $['comments.fallback.user'], { ns: 'workflowComments' }),
                    avatar_url: comment.created_by_account?.avatar_url ?? null,
                  },
                  currentUserId,
                )}
              />
              <div className="min-w-0 flex-1">
                <CommentComposerFrame>
                  <MentionInput
                    ref={attachEditField}
                    value={editingCommentContent}
                    onChange={setEditingCommentContent}
                    onSubmit={handleCommentEditSubmit}
                    onCancel={handleCancelCommentEdit}
                    placeholder={t(($) => $['comments.placeholder.editComment'], {
                      ns: 'workflowComments',
                    })}
                    disabled={loading}
                    loading={isSubmittingEdit}
                    isEditing={true}
                  />
                </CommentComposerFrame>
              </div>
            </div>
          ) : (
            <ThreadMessage
              author={comment.created_by_account}
              createdAt={comment.created_at ?? comment.updated_at ?? 0}
              content={comment.content}
              mentionNames={mentionableNames}
            />
          )}
        </CommentThreadItem>
        {replies.length > 0 && (
          <div>
            {replies.map((reply) => {
              const isReplyEditing = editingReply?.id === reply.id
              const isOwnReply = reply.created_by_account?.id === currentUserId
              return (
                <CommentThreadItem key={reply.id}>
                  {isOwnReply && !isReplyEditing && (
                    <Menu
                      open={activeReplyMenuId === reply.id}
                      onOpenChange={(open) => {
                        setActiveReplyMenuId(open ? reply.id : null)
                      }}
                    >
                      <MenuTrigger
                        className="absolute inset-e-2 top-2 flex size-6 items-center justify-center rounded-md text-text-tertiary opacity-0 group-hover:opacity-100 hover:bg-state-base-hover hover:text-text-secondary focus:opacity-100 data-popup-open:opacity-100 [@media(hover:none)]:opacity-100"
                        data-reply-menu
                        aria-label={t(($) => $['comments.aria.replyActions'], {
                          ns: 'workflowComments',
                        })}
                      >
                        <RiMoreFill className="size-4" />
                      </MenuTrigger>
                      <MenuContent
                        align="end"
                        className="w-36 backdrop-blur-[10px]"
                        data-reply-menu
                        finalFocus={menuFinalFocus}
                      >
                        <MenuItem
                          onClick={(event) => {
                            event.stopPropagation()
                            editOpeningRef.current = true
                            handleStartEdit(reply)
                          }}
                        >
                          {t(($) => $['comments.actions.editReply'], {
                            ns: 'workflowComments',
                          })}
                        </MenuItem>
                        <MenuItem
                          variant="destructive"
                          disabled={!onReplyDelete}
                          onClick={(event) => {
                            event.stopPropagation()
                            setDeletingReplyId(reply.id)
                          }}
                        >
                          {t(($) => $['comments.actions.deleteReply'], {
                            ns: 'workflowComments',
                          })}
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  )}
                  {isReplyEditing ? (
                    <div className="flex gap-3">
                      <CollaboratorAvatar
                        size="sm"
                        className="shrink-0"
                        collaborator={toCommentCollaborator(
                          {
                            id: reply.created_by_account?.id ?? '',
                            name:
                              reply.created_by_account?.name ||
                              t(($) => $['comments.fallback.user'], { ns: 'workflowComments' }),
                            avatar_url: reply.created_by_account?.avatar_url ?? null,
                          },
                          currentUserId,
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <CommentComposerFrame>
                          <MentionInput
                            ref={attachEditField}
                            value={editingReply?.content ?? ''}
                            onChange={(newContent) =>
                              setEditingReply((prev) =>
                                prev ? { ...prev, content: newContent } : prev,
                              )
                            }
                            onSubmit={handleEditSubmit}
                            onCancel={handleCancelEdit}
                            placeholder={t(($) => $['comments.placeholder.editReply'], {
                              ns: 'workflowComments',
                            })}
                            disabled={loading}
                            loading={replyUpdating || isSubmittingEdit}
                            isEditing={true}
                          />
                        </CommentComposerFrame>
                      </div>
                    </div>
                  ) : (
                    <ThreadMessage
                      author={reply.created_by_account}
                      createdAt={reply.created_at ?? 0}
                      content={reply.content}
                      mentionNames={mentionableNames}
                    />
                  )}
                </CommentThreadItem>
              )
            })}
          </div>
        )}
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
            ref={replyInputRef}
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
        open={deletingReplyId !== null && !replyWasDeleted}
        onOpenChangeComplete={(open) => {
          if (!open) setDeletingReplyId(null)
        }}
        onOpenChange={(open, eventDetails) => {
          if (!open && loading) {
            eventDetails.cancel()
            return
          }
          if (!open) setDeletingReplyId(null)
        }}
      >
        <AlertDialogContent finalFocus={replyWasDeleted ? replyInputRef : undefined}>
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
                if (deletingReplyId) return onReplyDelete?.(deletingReplyId)
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
