'use client'

import type { FC, ReactNode } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useViewport } from 'reactflow'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine, RiArrowUpSLine, RiCheckboxCircleFill, RiCheckboxCircleLine, RiCloseLine, RiDeleteBinLine, RiMoreFill } from '@remixicon/react'
import Avatar from '@/app/components/base/avatar'
import Divider from '@/app/components/base/divider'
import Tooltip from '@/app/components/base/tooltip'
import InlineDeleteConfirm from '@/app/components/base/inline-delete-confirm'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import cn from '@/utils/classnames'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import type { WorkflowCommentDetail, WorkflowCommentDetailReply } from '@/service/workflow-comment'
import { useAppContext } from '@/context/app-context'
import { MentionInput } from './mention-input'
import { getUserColor } from '@/app/components/workflow/collaboration/utils/user-color'

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
  onReply?: (content: string, mentionedUserIds?: string[]) => Promise<void> | void
  onReplyEdit?: (replyId: string, content: string, mentionedUserIds?: string[]) => Promise<void> | void
  onReplyDelete?: (replyId: string) => void
  onReplyDeleteDirect?: (replyId: string) => Promise<void> | void
}

const ThreadMessage: FC<{
  authorId: string
  authorName: string
  avatarUrl?: string | null
  createdAt: number
  content: string
  mentionedNames?: string[]
  className?: string
}> = ({ authorId, authorName, avatarUrl, createdAt, content, mentionedNames, className }) => {
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const { userProfile } = useAppContext()
  const currentUserId = userProfile?.id
  const isCurrentUser = authorId === currentUserId
  const userColor = isCurrentUser ? undefined : getUserColor(authorId)

  const highlightedContent = useMemo<ReactNode>(() => {
    if (!content)
      return ''

    const normalizedNames = Array.from(new Set((mentionedNames || [])
      .map(name => name.trim())
      .filter(Boolean)))

    if (normalizedNames.length === 0)
      return content

    const segments: ReactNode[] = []
    let hasMention = false
    let cursor = 0

    while (cursor < content.length) {
      let nextMatchStart = -1
      let matchedName = ''

      for (const name of normalizedNames) {
        const searchStart = content.indexOf(`@${name}`, cursor)
        if (searchStart === -1)
          continue

        const previousChar = searchStart > 0 ? content[searchStart - 1] : ''
        if (searchStart > 0 && !/\s/.test(previousChar))
          continue

        if (
          nextMatchStart === -1
          || searchStart < nextMatchStart
          || (searchStart === nextMatchStart && name.length > matchedName.length)
        ) {
          nextMatchStart = searchStart
          matchedName = name
        }
      }

      if (nextMatchStart === -1)
        break

      if (nextMatchStart > cursor)
        segments.push(<span key={`text-${cursor}`}>{content.slice(cursor, nextMatchStart)}</span>)

      const mentionEnd = nextMatchStart + matchedName.length + 1
      segments.push(
        <span key={`mention-${nextMatchStart}`} className='text-primary-600'>
          {content.slice(nextMatchStart, mentionEnd)}
        </span>,
      )
      hasMention = true
      cursor = mentionEnd
    }

    if (!hasMention)
      return content

    if (cursor < content.length)
      segments.push(<span key={`text-${cursor}`}>{content.slice(cursor)}</span>)

    return segments
  }, [content, mentionedNames])

  return (
    <div className={cn('flex gap-3 pt-1', className)}>
      <div className='shrink-0'>
        <Avatar
          name={authorName}
          avatar={avatarUrl || null}
          size={24}
          className={cn('h-8 w-8 rounded-full')}
          backgroundColor={userColor}
        />
      </div>
      <div className='min-w-0 flex-1 pb-4 text-text-primary last:pb-0'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
          <span className='system-sm-medium text-text-primary'>{authorName}</span>
          <span className='system-2xs-regular text-text-tertiary'>{formatTimeFromNow(createdAt * 1000)}</span>
        </div>
        <div className='system-sm-regular mt-1 whitespace-pre-wrap break-words text-text-secondary'>
          {highlightedContent}
        </div>
      </div>
    </div>
  )
}

export const CommentThread: FC<CommentThreadProps> = memo(({
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
  onReply,
  onReplyEdit,
  onReplyDelete,
  onReplyDeleteDirect,
}) => {
  const { flowToScreenPosition } = useReactFlow()
  const viewport = useViewport()
  const { userProfile } = useAppContext()
  const { t } = useTranslation()
  const [replyContent, setReplyContent] = useState('')
  const [activeReplyMenuId, setActiveReplyMenuId] = useState<string | null>(null)
  const [editingReply, setEditingReply] = useState<{ id: string; content: string }>({ id: '', content: '' })
  const [deletingReplyId, setDeletingReplyId] = useState<string | null>(null)

  // Focus management refs
  const replyInputRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setReplyContent('')
  }, [comment.id])

  // P0: Auto-focus reply input when thread opens or comment changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (replyInputRef.current && !editingReply.id && onReply)
        replyInputRef.current.focus()
    }, 100)

    return () => clearTimeout(timer)
  }, [comment.id, editingReply.id, onReply])

  // P2: Handle Esc key to close thread
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if actively editing a reply
      if (editingReply.id) return

      // Don't intercept if mention dropdown is open (let MentionInput handle it)
      if (document.querySelector('[data-mention-dropdown]')) return

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose, editingReply.id])

  const handleReplySubmit = useCallback(async (content: string, mentionedUserIds: string[]) => {
    if (!onReply || replySubmitting) return

    setReplyContent('')

    try {
      await onReply(content, mentionedUserIds)

      // P0: Restore focus to reply input after successful submission
      setTimeout(() => {
        replyInputRef.current?.focus()
      }, 0)
    }
    catch (error) {
      console.error('Failed to send reply', error)
      setReplyContent(content)
    }
  }, [onReply, replySubmitting])

  const screenPosition = useMemo(() => {
    return flowToScreenPosition({
      x: comment.position_x,
      y: comment.position_y,
    })
  }, [comment.position_x, comment.position_y, viewport.x, viewport.y, viewport.zoom, flowToScreenPosition])

  const handleStartEdit = useCallback((reply: WorkflowCommentDetailReply) => {
    setEditingReply({ id: reply.id, content: reply.content })
    setActiveReplyMenuId(null)
  }, [])

  const handleCancelEdit = useCallback(() => {
    setEditingReply({ id: '', content: '' })

    // P1: Restore focus to reply input after canceling edit
    setTimeout(() => {
      replyInputRef.current?.focus()
    }, 0)
  }, [])

  const handleEditSubmit = useCallback(async (content: string, mentionedUserIds: string[]) => {
    if (!onReplyEdit || !editingReply) return
    const trimmed = content.trim()
    if (!trimmed) return
    await onReplyEdit(editingReply.id, trimmed, mentionedUserIds)
    setEditingReply({ id: '', content: '' })

    // P1: Restore focus to reply input after saving edit
    setTimeout(() => {
      replyInputRef.current?.focus()
    }, 0)
  }, [editingReply, onReplyEdit])

  const replies = comment.replies || []
  const messageListRef = useRef<HTMLDivElement>(null)
  const previousReplyCountRef = useRef<number | undefined>(undefined)
  const previousCommentIdRef = useRef<string | undefined>(undefined)

  // Close dropdown when scrolling
  useEffect(() => {
    const container = messageListRef.current
    if (!container || !activeReplyMenuId)
      return

    const handleScroll = () => {
      setActiveReplyMenuId(null)
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [activeReplyMenuId])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const container = messageListRef.current
    if (!container)
      return

    const isFirstRender = previousCommentIdRef.current === undefined
    const isNewComment = comment.id !== previousCommentIdRef.current
    const hasNewReply = previousReplyCountRef.current !== undefined
      && replies.length > previousReplyCountRef.current

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

  const mentionsByTarget = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const mention of comment.mentions || []) {
      const name = mention.mentioned_user_account?.name?.trim()
      if (!name)
        continue
      const key = mention.reply_id ?? 'root'
      const existing = map.get(key)
      if (existing) {
        if (!existing.includes(name))
          existing.push(name)
      }
      else {
        map.set(key, [name])
      }
    }
    return map
  }, [comment.mentions])

  return (
    <div
      className='absolute z-50 w-[360px] max-w-[360px]'
      style={{
        left: screenPosition.x + 40,
        top: screenPosition.y,
        transform: 'translateY(-20%)',
      }}
    >
      <div
        ref={threadRef}
        className='relative flex h-[360px] flex-col overflow-hidden rounded-2xl border border-components-panel-border bg-components-panel-bg shadow-xl'
        role='dialog'
        aria-modal='true'
        aria-labelledby='comment-thread-title'
      >
        <div className='flex items-center justify-between rounded-t-2xl border-b border-components-panel-border bg-components-panel-bg-blur px-4 py-3'>
          <div
            id='comment-thread-title'
            className='font-semibold uppercase text-text-primary'
          >
            {t('workflow.comments.panelTitle')}
          </div>
          <div className='flex items-center gap-1'>
            <Tooltip
              popupContent={t('workflow.comments.aria.deleteComment')}
              position='top'
              popupClassName='!px-2 !py-1.5'
            >
              <button
                type='button'
                disabled={loading}
                className={cn('flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled')}
                onClick={onDelete}
                aria-label={t('workflow.comments.aria.deleteComment')}
              >
                <RiDeleteBinLine className='h-4 w-4' />
              </button>
            </Tooltip>
            <Tooltip
              popupContent={t('workflow.comments.aria.resolveComment')}
              position='top'
              popupClassName='!px-2 !py-1.5'
            >
              <button
                type='button'
                disabled={comment.resolved || loading}
                className={cn('flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled')}
                onClick={onResolve}
                aria-label={t('workflow.comments.aria.resolveComment')}
              >
                {comment.resolved ? <RiCheckboxCircleFill className='h-4 w-4' /> : <RiCheckboxCircleLine className='h-4 w-4' />}
              </button>
            </Tooltip>
            <Divider type='vertical' className='h-3.5' />
            <Tooltip
              popupContent={t('workflow.comments.aria.previousComment')}
              position='top'
              popupClassName='!px-2 !py-1.5'
            >
              <button
                type='button'
                disabled={!canGoPrev || loading}
                className={cn('flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled')}
                onClick={onPrev}
                aria-label={t('workflow.comments.aria.previousComment')}
              >
                <RiArrowUpSLine className='h-4 w-4' />
              </button>
            </Tooltip>
            <Tooltip
              popupContent={t('workflow.comments.aria.nextComment')}
              position='top'
              popupClassName='!px-2 !py-1.5'
            >
              <button
                type='button'
                disabled={!canGoNext || loading}
                className={cn('flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled')}
                onClick={onNext}
                aria-label={t('workflow.comments.aria.nextComment')}
              >
                <RiArrowDownSLine className='h-4 w-4' />
              </button>
            </Tooltip>
            <button
              type='button'
              className='flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary'
              onClick={onClose}
              aria-label={t('workflow.comments.aria.closeComment')}
            >
              <RiCloseLine className='h-4 w-4' />
            </button>
          </div>
        </div>
        <div
          ref={messageListRef}
          className='relative mt-2 flex-1 overflow-y-auto px-4 pb-4'
        >
          <div className='rounded-lg py-2 pl-1 transition-colors hover:bg-components-panel-on-panel-item-bg-hover'>
            <ThreadMessage
              authorId={comment.created_by_account?.id || ''}
              authorName={comment.created_by_account?.name || t('workflow.comments.fallback.user')}
              avatarUrl={comment.created_by_account?.avatar_url || null}
              createdAt={comment.created_at}
              content={comment.content}
              mentionedNames={mentionsByTarget.get('root')}
            />
          </div>
          {replies.length > 0 && (
            <div className='mt-2 space-y-3 pt-3'>
              {replies.map((reply) => {
                const isReplyEditing = editingReply?.id === reply.id
                const isOwnReply = reply.created_by_account?.id === userProfile?.id
                return (
                  <div
                    key={reply.id}
                    className='group relative rounded-lg py-2 pl-1 transition-colors hover:bg-components-panel-on-panel-item-bg-hover'
                  >
                    {isOwnReply && !isReplyEditing && (
                      <PortalToFollowElem
                        placement='bottom-end'
                        open={activeReplyMenuId === reply.id}
                        onOpenChange={(open) => {
                          if (!open) {
                            setDeletingReplyId(null)
                            setActiveReplyMenuId(null)
                          }
                        }}
                      >
                        <div
                          className={cn(
                            'absolute right-1 top-1 gap-1',
                            activeReplyMenuId === reply.id ? 'flex' : 'hidden group-hover:flex',
                          )}
                          data-reply-menu
                        >
                          <PortalToFollowElemTrigger asChild>
                            <button
                              type='button'
                              className='flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary'
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeletingReplyId(null)
                                setActiveReplyMenuId(prev => prev === reply.id ? null : reply.id)
                              }}
                              aria-label={t('workflow.comments.aria.replyActions')}
                            >
                              <RiMoreFill className='h-4 w-4' />
                            </button>
                          </PortalToFollowElemTrigger>
                        </div>
                        <PortalToFollowElemContent
                          className='z-[100] w-36 rounded-xl border border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[10px]'
                          data-reply-menu
                        >
                          {/* Menu buttons - hidden when showing delete confirm */}
                          <div className={cn(deletingReplyId === reply.id ? 'hidden' : 'block')}>
                            <button
                              className='flex w-full items-center justify-start rounded-t-xl px-3 py-2 text-left text-sm text-text-secondary hover:bg-state-base-hover'
                              onClick={(e) => {
                                e.stopPropagation()
                                handleStartEdit(reply)
                              }}
                            >
                              {t('workflow.comments.actions.editReply')}
                            </button>
                            <button
                              className='text-negative flex w-full items-center justify-start rounded-b-xl px-3 py-2 text-left text-sm text-text-secondary hover:bg-state-base-hover'
                              onClick={(e) => {
                                e.stopPropagation()
                                e.preventDefault()
                                if (onReplyDeleteDirect) {
                                  setDeletingReplyId(reply.id)
                                }
                                else {
                                  setActiveReplyMenuId(null)
                                  onReplyDelete?.(reply.id)
                                }
                              }}
                            >
                              {t('workflow.comments.actions.deleteReply')}
                            </button>
                          </div>

                          {/* Delete confirmation - shown when deletingReplyId matches */}
                          <div className={cn(deletingReplyId === reply.id ? 'block' : 'hidden')}>
                            <InlineDeleteConfirm
                              title={t('workflow.comments.actions.deleteReply')}
                              onConfirm={() => {
                                setDeletingReplyId(null)
                                setActiveReplyMenuId(null)
                                onReplyDeleteDirect?.(reply.id)
                              }}
                              onCancel={() => {
                                setDeletingReplyId(null)
                              }}
                              className='m-0 w-full border-0 shadow-none'
                            />
                          </div>
                        </PortalToFollowElemContent>
                      </PortalToFollowElem>
                    )}
                    {isReplyEditing ? (
                      <div className='rounded-lg border border-components-chat-input-border bg-components-panel-bg-blur px-3 py-2 shadow-sm'>
                        <MentionInput
                          value={editingReply?.content ?? ''}
                          onChange={newContent => setEditingReply(prev => prev ? { ...prev, content: newContent } : prev)}
                          onSubmit={handleEditSubmit}
                          onCancel={handleCancelEdit}
                          placeholder={t('workflow.comments.placeholder.editReply')}
                          disabled={loading}
                          loading={replyUpdating}
                          isEditing={true}
                          className="system-sm-regular"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <ThreadMessage
                        authorId={reply.created_by_account?.id || ''}
                        authorName={reply.created_by_account?.name || t('workflow.comments.fallback.user')}
                        avatarUrl={reply.created_by_account?.avatar_url || null}
                        createdAt={reply.created_at}
                        content={reply.content}
                        mentionedNames={mentionsByTarget.get(reply.id)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {loading && (
          <div className='bg-components-panel-bg/70 absolute inset-0 z-30 flex items-center justify-center text-sm text-text-tertiary'>
            {t('workflow.comments.loading')}
          </div>
        )}
        {onReply && (
          <div className='border-t border-components-panel-border px-4 py-3'>
            <div className='flex items-center gap-3'>
              <Avatar
                avatar={userProfile?.avatar_url || null}
                name={userProfile?.name || t('common.you')}
                size={24}
                className='h-8 w-8'
              />
              <div className='flex-1 rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur p-[2px] shadow-sm'>
                <MentionInput
                  ref={replyInputRef}
                  value={replyContent}
                  onChange={setReplyContent}
                  onSubmit={handleReplySubmit}
                  placeholder={t('workflow.comments.placeholder.reply')}
                  disabled={loading}
                  loading={replySubmitting}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

CommentThread.displayName = 'CommentThread'
