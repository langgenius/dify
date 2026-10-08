'use client'

import type { ReactNode } from 'react'
import type {
  WorkflowCommentDetail,
  WorkflowCommentDetailReply,
} from '@/app/components/workflow/comment/types'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage, AvatarRoot } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Separator } from '@langgenius/dify-ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCheckboxCircleFill,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiMoreFill,
} from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow, useViewport } from 'reactflow'
import { getUserColor } from '@/app/components/workflow/collaboration/utils/user-color'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useParams } from '@/next/navigation'
import { useStore } from '../store'
import { MentionInput } from './mention-input'

type CommentThreadProps = {
  comment: WorkflowCommentDetail
  loading?: boolean
  replySubmitting?: boolean
  replyUpdating?: boolean
  onClose: () => void
  onDelete?: () => void
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
  onReplyDelete?: (replyId: string) => void
  onReplyDeleteDirect?: (replyId: string) => Promise<void> | void
}

type ThreadMessageProps = {
  authorId: string
  authorName: string
  avatarUrl?: string | null
  createdAt: number
  content: string
  mentionableNames: string[]
  className?: string
}

function ThreadMessage({
  authorId,
  authorName,
  avatarUrl,
  createdAt,
  content,
  mentionableNames,
  className,
}: ThreadMessageProps) {
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const isCurrentUser = authorId === currentUserId
  const userColor = isCurrentUser ? undefined : getUserColor(authorId)

  const highlightedContent = useMemo<ReactNode>(() => {
    if (!content) return ''

    // Extract valid user names from mentionableNames, sorted by length (longest first)
    const normalizedNames = Array.from(
      new Set(mentionableNames.map((name) => name.trim()).filter(Boolean)),
    )
    normalizedNames.sort((a, b) => b.length - a.length)

    if (normalizedNames.length === 0) return content

    const segments: ReactNode[] = []
    let hasMention = false
    let cursor = 0

    while (cursor < content.length) {
      let nextMatchStart = -1
      let matchedName = ''

      for (const name of normalizedNames) {
        const searchStart = content.indexOf(`@${name}`, cursor)
        if (searchStart === -1) continue

        const previousChar = searchStart > 0 ? content[searchStart - 1] : ''
        if (searchStart > 0 && !/\s/.test(previousChar!)) continue

        if (
          nextMatchStart === -1 ||
          searchStart < nextMatchStart ||
          (searchStart === nextMatchStart && name.length > matchedName.length)
        ) {
          nextMatchStart = searchStart
          matchedName = name
        }
      }

      if (nextMatchStart === -1) break

      if (nextMatchStart > cursor)
        segments.push(<span key={`text-${cursor}`}>{content.slice(cursor, nextMatchStart)}</span>)

      const mentionEnd = nextMatchStart + matchedName.length + 1
      segments.push(
        <span key={`mention-${nextMatchStart}`} className="text-primary-600">
          {content.slice(nextMatchStart, mentionEnd)}
        </span>,
      )
      hasMention = true
      cursor = mentionEnd
    }

    if (!hasMention) return content

    if (cursor < content.length)
      segments.push(<span key={`text-${cursor}`}>{content.slice(cursor)}</span>)

    return segments
  }, [content, mentionableNames])

  return (
    <div className={cn('flex gap-3 pt-1', className)}>
      <div className="shrink-0">
        <AvatarRoot size="sm" className={cn('size-8 rounded-full')}>
          {avatarUrl && <AvatarImage src={avatarUrl} alt={authorName} />}
          <AvatarFallback size="sm" style={userColor ? { backgroundColor: userColor } : undefined}>
            {authorName?.[0]?.toLocaleUpperCase()}
          </AvatarFallback>
        </AvatarRoot>
      </div>
      <div className="min-w-0 flex-1 pb-4 text-text-primary last:pb-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="system-sm-medium text-text-primary">{authorName}</span>
          <span className="system-2xs-regular text-text-tertiary">
            {formatTimeFromNow(createdAt * 1000)}
          </span>
        </div>
        <div className="mt-1 system-sm-regular wrap-break-word whitespace-pre-wrap text-text-secondary">
          {highlightedContent}
        </div>
      </div>
    </div>
  )
}

function CommentThreadComponent({
  comment,
  loading = false,
  replySubmitting = false,
  replyUpdating = false,
  onClose,
  onDelete,
  onResolve,
  onPrev,
  onNext,
  canGoPrev,
  canGoNext,
  onCommentEdit,
  onReply,
  onReplyEdit,
  onReplyDelete,
  onReplyDeleteDirect,
}: CommentThreadProps) {
  const params = useParams()
  const appId = params.appId as string
  const { flowToScreenPosition } = useReactFlow()
  const viewport = useViewport()
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

  // Focus management refs
  const replyInputRef = useRef<HTMLTextAreaElement>(null)
  const replyMenuTriggersRef = useRef(new Map<string, HTMLButtonElement>())
  const deleteReplyTriggerRef = useRef<HTMLButtonElement | null>(null)

  // Get mentionable users from store
  const mentionUsersFromStore = useStore((state) =>
    appId ? state.mentionableUsersCache[appId] : undefined,
  )
  const mentionUsers = mentionUsersFromStore ?? []
  const setCommentPreviewHovering = useStore((state) => state.setCommentPreviewHovering)

  // Extract all mentionable names for highlighting
  const mentionableNames = useMemo(() => {
    const names = mentionUsers
      .map((user) => user.name?.trim())
      .filter((name): name is string => Boolean(name))
    return Array.from(new Set(names))
  }, [mentionUsers])

  useEffect(() => {
    Promise.resolve().then(() => {
      setReplyContent('')
      setEditingCommentContent('')
      setIsCommentEditing(false)
      setEditingReply({ id: '', content: '' })
      setActiveReplyMenuId(null)
      setDeletingReplyId(null)
    })
  }, [comment.id])

  useEffect(
    () => () => {
      setCommentPreviewHovering(false)
    },
    [setCommentPreviewHovering],
  )

  const canReply = Boolean(onReply)

  // Focus on thread transitions, not callback changes after position updates.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (replyInputRef.current && !editingReply.id && !isCommentEditing && canReply)
        replyInputRef.current.focus()
    }, 100)

    return () => clearTimeout(timer)
  }, [comment.id, editingReply.id, isCommentEditing, canReply])

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
    [onReply, replySubmitting],
  )

  const screenPosition = useMemo(() => {
    return flowToScreenPosition({
      x: comment.position_x,
      y: comment.position_y,
    })
  }, [
    comment.position_x,
    comment.position_y,
    viewport.x,
    viewport.y,
    viewport.zoom,
    flowToScreenPosition,
  ])
  const workflowContainerRect =
    typeof document !== 'undefined'
      ? document.getElementById('workflow-container')?.getBoundingClientRect()
      : null
  const containerLeft = workflowContainerRect?.left ?? 0
  const containerTop = workflowContainerRect?.top ?? 0
  const canvasPosition = useMemo(
    () => ({
      x: screenPosition.x - containerLeft,
      y: screenPosition.y - containerTop,
    }),
    [screenPosition.x, screenPosition.y, containerLeft, containerTop],
  )

  const handleStartEdit = useCallback((reply: WorkflowCommentDetailReply) => {
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
  }, [])

  const handleCancelCommentEdit = useCallback(() => {
    setEditingCommentContent('')
    setIsCommentEditing(false)

    setTimeout(() => {
      replyInputRef.current?.focus()
    }, 0)
  }, [])

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
    [onCommentEdit],
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
    [editingReply, onReplyEdit],
  )

  const replies = comment.replies || []
  const isOwnComment = comment.created_by_account?.id === currentUserId
  const messageListRef = useRef<HTMLDivElement>(null)
  const previousReplyCountRef = useRef<number | undefined>(undefined)
  const previousCommentIdRef = useRef<string | undefined>(undefined)

  // Close dropdown when scrolling
  useEffect(() => {
    const container = messageListRef.current
    if (!container || !activeReplyMenuId) return

    const handleScroll = () => {
      setActiveReplyMenuId(null)
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [activeReplyMenuId])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const container = messageListRef.current
    if (!container) return

    const isFirstRender = previousCommentIdRef.current === undefined
    const isNewComment = comment.id !== previousCommentIdRef.current
    const hasNewReply =
      previousReplyCountRef.current !== undefined && replies.length > previousReplyCountRef.current

    // Scroll on first render, new comment, or new reply
    if (isFirstRender || isNewComment || hasNewReply) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      })
    }

    previousCommentIdRef.current = comment.id
    previousReplyCountRef.current = replies.length
  }, [comment.id, replies.length])

  return (
    <div
      className="absolute z-30 w-90 max-w-90"
      style={{
        left: canvasPosition.x + 40,
        top: canvasPosition.y,
        transform: 'translateY(-20%)',
      }}
      onMouseEnter={() => setCommentPreviewHovering(true)}
      onMouseLeave={() => setCommentPreviewHovering(false)}
    >
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The thread handles bubbling Escape after its child editor and menus have handled it. */}
      <div
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.key !== 'Escape')
            return
          if (editingReply.id || isCommentEditing) return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
        className="relative flex h-90 flex-col overflow-hidden rounded-2xl border border-components-panel-border bg-components-panel-bg shadow-xl"
        role="dialog"
        aria-labelledby="comment-thread-title"
      >
        <div className="flex items-center justify-between rounded-t-2xl border-b border-components-panel-border bg-components-panel-bg-blur px-4 py-3">
          <div id="comment-thread-title" className="font-semibold text-text-primary uppercase">
            {t(($) => $['comments.panelTitle'], { ns: 'workflowComments' })}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    disabled={loading}
                    className={cn(
                      'flex size-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled',
                    )}
                    onClick={onDelete}
                    aria-label={t(($) => $['comments.aria.deleteComment'], {
                      ns: 'workflowComments',
                    })}
                  >
                    <RiDeleteBinLine className="size-4" />
                  </button>
                }
              />
              <TooltipContent placement="top">
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
                      'flex size-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled',
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
              <TooltipContent placement="top">
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
                      'flex size-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled',
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
              <TooltipContent placement="top">
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
                      'flex size-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled',
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
              <TooltipContent placement="top">
                {t(($) => $['comments.aria.nextComment'], { ns: 'workflowComments' })}
              </TooltipContent>
            </Tooltip>
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
              onClick={onClose}
              aria-label={t(($) => $['comments.aria.closeComment'], { ns: 'workflowComments' })}
            >
              <RiCloseLine className="size-4" />
            </button>
          </div>
        </div>
        <div ref={messageListRef} className="relative mt-2 flex-1 overflow-y-auto px-4 pb-4">
          <div className="group relative -mx-4 rounded-lg px-4 py-2 transition-colors hover:bg-components-panel-on-panel-item-bg-hover">
            {isOwnComment && !isCommentEditing && (
              <DropdownMenu
                open={activeReplyMenuId === comment.id}
                onOpenChange={(open) => setActiveReplyMenuId(open ? comment.id : null)}
              >
                <DropdownMenuTrigger
                  className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-md text-text-tertiary opacity-0 outline-hidden group-hover:opacity-100 hover:bg-state-base-hover hover:text-text-secondary focus:opacity-100 focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:opacity-100 [@media(hover:none)]:opacity-100"
                  aria-label={t(($) => $['comments.aria.commentActions'], {
                    ns: 'workflowComments',
                  })}
                >
                  <RiMoreFill className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  placement="bottom-end"
                  sideOffset={4}
                  className="w-36 backdrop-blur-[10px]"
                >
                  <DropdownMenuItem
                    className="px-3"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStartCommentEdit()
                    }}
                  >
                    {t(($) => $['comments.actions.editComment'], { ns: 'workflowComments' })}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {isCommentEditing ? (
              <div className="flex gap-3 pt-1">
                <div className="shrink-0">
                  <Avatar
                    name={
                      comment.created_by_account?.name ||
                      t(($) => $['comments.fallback.user'], { ns: 'workflowComments' })
                    }
                    avatar={comment.created_by_account?.avatar_url || null}
                    size="sm"
                    className="size-8 rounded-full"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur p-1 shadow-md backdrop-blur-[10px]">
                    <MentionInput
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
                      className="system-sm-regular"
                      autoFocus
                    />
                  </div>
                </div>
              </div>
            ) : (
              <ThreadMessage
                authorId={comment.created_by_account?.id || ''}
                authorName={
                  comment.created_by_account?.name ||
                  t(($) => $['comments.fallback.user'], { ns: 'workflowComments' })
                }
                avatarUrl={comment.created_by_account?.avatar_url || null}
                createdAt={comment.created_at ?? comment.updated_at ?? 0}
                content={comment.content}
                mentionableNames={mentionableNames}
              />
            )}
          </div>
          {replies.length > 0 && (
            <div className="mt-2 space-y-3 pt-3">
              {replies.map((reply) => {
                const isReplyEditing = editingReply?.id === reply.id
                const isOwnReply = reply.created_by_account?.id === currentUserId
                return (
                  <div
                    key={reply.id}
                    className="group relative -mx-4 rounded-lg px-4 py-2 transition-colors hover:bg-components-panel-on-panel-item-bg-hover"
                  >
                    {isOwnReply && !isReplyEditing && (
                      <DropdownMenu
                        open={activeReplyMenuId === reply.id}
                        onOpenChange={(open) => {
                          setActiveReplyMenuId(open ? reply.id : null)
                        }}
                      >
                        <DropdownMenuTrigger
                          ref={(element: HTMLButtonElement | null) => {
                            if (element) replyMenuTriggersRef.current.set(reply.id, element)
                            else replyMenuTriggersRef.current.delete(reply.id)
                          }}
                          className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-md text-text-tertiary opacity-0 outline-hidden group-hover:opacity-100 hover:bg-state-base-hover hover:text-text-secondary focus:opacity-100 focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:opacity-100 [@media(hover:none)]:opacity-100"
                          data-reply-menu
                          aria-label={t(($) => $['comments.aria.replyActions'], {
                            ns: 'workflowComments',
                          })}
                        >
                          <RiMoreFill className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          placement="bottom-end"
                          sideOffset={4}
                          className="w-36 backdrop-blur-[10px]"
                          data-reply-menu
                        >
                          <DropdownMenuItem
                            onClick={(event) => {
                              event.stopPropagation()
                              handleStartEdit(reply)
                            }}
                          >
                            {t(($) => $['comments.actions.editReply'], {
                              ns: 'workflowComments',
                            })}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={(event) => {
                              event.stopPropagation()
                              setActiveReplyMenuId(null)
                              if (onReplyDeleteDirect) {
                                deleteReplyTriggerRef.current =
                                  replyMenuTriggersRef.current.get(reply.id) ?? null
                                queueMicrotask(() => setDeletingReplyId(reply.id))
                              } else onReplyDelete?.(reply.id)
                            }}
                          >
                            {t(($) => $['comments.actions.deleteReply'], {
                              ns: 'workflowComments',
                            })}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {isReplyEditing ? (
                      <div className="flex gap-3 pt-1">
                        <div className="shrink-0">
                          <Avatar
                            name={
                              reply.created_by_account?.name ||
                              t(($) => $['comments.fallback.user'], { ns: 'workflowComments' })
                            }
                            avatar={reply.created_by_account?.avatar_url || null}
                            size="sm"
                            className="size-8 rounded-full"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur p-1 shadow-md backdrop-blur-[10px]">
                            <MentionInput
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
                              className="system-sm-regular"
                              autoFocus
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <ThreadMessage
                        authorId={reply.created_by_account?.id || ''}
                        authorName={
                          reply.created_by_account?.name ||
                          t(($) => $['comments.fallback.user'], { ns: 'workflowComments' })
                        }
                        avatarUrl={reply.created_by_account?.avatar_url || null}
                        createdAt={reply.created_at ?? 0}
                        content={reply.content}
                        mentionableNames={mentionableNames}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {loading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-components-panel-bg/70 text-sm text-text-tertiary">
            {t(($) => $['comments.loading'], { ns: 'workflowComments' })}
          </div>
        )}
        {onReply && (
          <div className="border-t border-components-panel-border px-4 py-3">
            <div className="flex items-center gap-3">
              <Avatar
                avatar={userProfile?.avatar_url || null}
                name={userProfile?.name || t(($) => $.you, { ns: 'common' })}
                size="sm"
                className="size-8"
              />
              <div className="flex-1 rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur p-0.5 shadow-sm">
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
              </div>
            </div>
          </div>
        )}
      </div>
      <AlertDialog
        open={deletingReplyId !== null}
        onOpenChange={(open, eventDetails) => {
          if (!open && loading) {
            eventDetails.cancel()
            return
          }
          if (!open) setDeletingReplyId(null)
        }}
      >
        <AlertDialogContent
          finalFocus={() =>
            deleteReplyTriggerRef.current?.isConnected
              ? deleteReplyTriggerRef.current
              : (replyInputRef.current ?? true)
          }
        >
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['comments.actions.deleteReply'], { ns: 'workflowComments' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-md-regular text-text-tertiary">
              {t(($) => $['operation.confirmAction'], { ns: 'common' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={loading}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={loading}
              onClick={async () => {
                if (deletingReplyId) await onReplyDeleteDirect?.(deletingReplyId)
                setDeletingReplyId(null)
              }}
            >
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const CommentThread = memo(CommentThreadComponent)

CommentThread.displayName = 'CommentThread'
