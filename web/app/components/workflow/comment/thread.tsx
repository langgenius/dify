'use client'

import { useParams } from 'next/navigation'

import type { FC } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useReactFlow, useViewport } from 'reactflow'
import { RiArrowDownSLine, RiArrowUpLine, RiArrowUpSLine, RiAtLine, RiCheckboxCircleFill, RiCheckboxCircleLine, RiCloseLine, RiDeleteBinLine } from '@remixicon/react'
import Textarea from 'react-textarea-autosize'
import Avatar from '@/app/components/base/avatar'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import cn from '@/utils/classnames'
import { useFormatTimeFromNow } from '@/app/components/workflow/hooks'
import type { UserProfile, WorkflowCommentDetail, WorkflowCommentDetailReply } from '@/service/workflow-comment'
import { fetchMentionableUsers } from '@/service/workflow-comment'
import { useAppContext } from '@/context/app-context'

type CommentThreadProps = {
  comment: WorkflowCommentDetail
  loading?: boolean
  onClose: () => void
  onDelete?: () => void
  onResolve?: () => void
  onPrev?: () => void
  onNext?: () => void
  canGoPrev?: boolean
  canGoNext?: boolean
  onReply?: (content: string, mentionedUserIds?: string[]) => Promise<void> | void
}

const ThreadMessage: FC<{
  authorName: string
  avatarUrl?: string | null
  createdAt: number
  content: string
}> = ({ authorName, avatarUrl, createdAt, content }) => {
  const { formatTimeFromNow } = useFormatTimeFromNow()

  return (
    <div className={cn('flex gap-3 pt-1')}>
      <div className='shrink-0'>
        <Avatar
          name={authorName}
          avatar={avatarUrl || null}
          size={24}
          className={cn('h-8 w-8 rounded-full')}
        />
      </div>
      <div className='min-w-0 flex-1 pb-4 text-text-primary last:pb-0'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
          <span className='system-sm-medium text-text-primary'>{authorName}</span>
          <span className='system-2xs-regular text-text-tertiary'>{formatTimeFromNow(createdAt * 1000)}</span>
        </div>
        <div className='system-sm-regular mt-1 whitespace-pre-wrap break-words text-text-secondary'>
          {content}
        </div>
      </div>
    </div>
  )
}

const renderReply = (reply: WorkflowCommentDetailReply) => (
  <ThreadMessage
    key={reply.id}
    authorName={reply.created_by_account?.name || 'User'}
    avatarUrl={reply.created_by_account?.avatar_url || null}
    createdAt={reply.created_at}
    content={reply.content}
  />
)

export const CommentThread: FC<CommentThreadProps> = memo(({
  comment,
  loading = false,
  onClose,
  onDelete,
  onResolve,
  onPrev,
  onNext,
  canGoPrev,
  canGoNext,
  onReply,
}) => {
  const params = useParams()
  const appId = params?.appId as string | undefined
  const { flowToScreenPosition } = useReactFlow()
  const viewport = useViewport()
  const { userProfile } = useAppContext()
  const [replyContent, setReplyContent] = useState('')
  const [mentionUsers, setMentionUsers] = useState<UserProfile[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const [mentionLoaded, setMentionLoaded] = useState(false)
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionPosition, setMentionPosition] = useState(0)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const loadMentionUsers = useCallback(async () => {
    if (!onReply || !appId) {
      setMentionUsers([])
      setMentionLoaded(false)
      return
    }
    setMentionLoading(true)
    try {
      const users = await fetchMentionableUsers(appId)
      setMentionUsers(users)
      setMentionLoaded(true)
    }
    catch (error) {
      console.error('Failed to load mention users', error)
    }
    finally {
      setMentionLoading(false)
    }
  }, [appId, onReply])

  useEffect(() => {
    loadMentionUsers()
  }, [loadMentionUsers])

  useEffect(() => {
    setReplyContent('')
    setMentionedUserIds([])
    setShowMentionDropdown(false)
  }, [comment.id])

  const handleReplySubmit = useCallback(async () => {
    const trimmed = replyContent.trim()
    if (!onReply || !trimmed || loading)
      return
    try {
      await onReply(trimmed, mentionedUserIds)
      setReplyContent('')
      setMentionedUserIds([])
      setShowMentionDropdown(false)
    }
    catch (error) {
      console.error('Failed to send reply', error)
    }
  }, [replyContent, onReply, loading, mentionedUserIds])

  const filteredMentionUsers = useMemo(() => {
    if (!mentionQuery) return mentionUsers
    return mentionUsers.filter(user =>
      user.name.toLowerCase().includes(mentionQuery.toLowerCase())
      || user.email?.toLowerCase().includes(mentionQuery.toLowerCase()),
    )
  }, [mentionUsers, mentionQuery])

  const dropdownPosition = useMemo(() => {
    if (!showMentionDropdown || !textareaRef.current)
      return { x: 0, y: 0 }
    const rect = textareaRef.current.getBoundingClientRect()
    return { x: rect.left, y: rect.bottom + 4 }
  }, [showMentionDropdown])

  const handleContentChange = useCallback((value: string) => {
    setReplyContent(value)
    setTimeout(() => {
      const cursorPosition = textareaRef.current?.selectionStart || 0
      const textBeforeCursor = value.slice(0, cursorPosition)
      const mentionMatch = textBeforeCursor.match(/@(\w*)$/)
      if (mentionMatch) {
        setMentionQuery(mentionMatch[1])
        setMentionPosition(cursorPosition - mentionMatch[0].length)
        setShowMentionDropdown(true)
        setSelectedMentionIndex(0)
      }
      else {
        setShowMentionDropdown(false)
      }
    }, 0)
  }, [])

  const handleMentionButtonClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!onReply || loading) return
    if (!mentionLoaded && !mentionLoading)
      await loadMentionUsers()
    if (!textareaRef.current) return
    const cursorPosition = textareaRef.current.selectionStart || 0
    const newContent = `${replyContent.slice(0, cursorPosition)}@${replyContent.slice(cursorPosition)}`
    setReplyContent(newContent)
    setTimeout(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      const newCursorPos = cursorPosition + 1
      textarea.setSelectionRange(newCursorPos, newCursorPos)
      textarea.focus()
      setMentionQuery('')
      setMentionPosition(cursorPosition)
      setShowMentionDropdown(true)
      setSelectedMentionIndex(0)
    }, 0)
  }, [loadMentionUsers, mentionLoaded, mentionLoading, replyContent])

  const insertMention = useCallback((user: UserProfile) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const beforeMention = replyContent.slice(0, mentionPosition)
    const afterMention = replyContent.slice(textarea.selectionStart || 0)
    const newContent = `${beforeMention}@${user.name} ${afterMention}`
    setReplyContent(newContent)
    setShowMentionDropdown(false)
    setMentionedUserIds(prev => prev.includes(user.id) ? prev : [...prev, user.id])
    setTimeout(() => {
      const newCursorPos = mentionPosition + user.name.length + 2
      textarea.setSelectionRange(newCursorPos, newCursorPos)
      textarea.focus()
    }, 0)
  }, [mentionPosition, replyContent])

  const handleReplyKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentionDropdown) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedMentionIndex(prev => prev < filteredMentionUsers.length - 1 ? prev + 1 : 0)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedMentionIndex(prev => prev > 0 ? prev - 1 : filteredMentionUsers.length - 1)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const targetUser = filteredMentionUsers[selectedMentionIndex]
        if (targetUser)
          insertMention(targetUser)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowMentionDropdown(false)
        return
      }
    }
    if (!onReply) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleReplySubmit()
    }
  }, [filteredMentionUsers, handleReplySubmit, insertMention, selectedMentionIndex, showMentionDropdown])

  const screenPosition = useMemo(() => {
    return flowToScreenPosition({
      x: comment.position_x,
      y: comment.position_y,
    })
  }, [comment.position_x, comment.position_y, viewport.x, viewport.y, viewport.zoom, flowToScreenPosition])

  return (
    <div
      className='absolute z-50 w-[360px] max-w-[360px]'
      style={{
        left: screenPosition.x,
        top: screenPosition.y,
        transform: 'translate(-50%, -100%) translateY(-24px)',
      }}
    >
      <div className='relative flex h-[360px] flex-col overflow-hidden rounded-2xl border border-components-panel-border bg-components-panel-bg shadow-xl'>
        <div className='flex items-center justify-between rounded-t-2xl border-b border-components-panel-border bg-components-panel-bg-blur px-4 py-3'>
          <div className=' font-semibold uppercase text-text-primary'>Comment</div>
          <div className='flex items-center gap-1'>
            <button
              type='button'
              disabled={loading}
              className={cn('flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled')}
              onClick={onDelete}
              aria-label='Delete comment'
            >
              <RiDeleteBinLine className='h-4 w-4' />
            </button>
            <button
              type='button'
              disabled={comment.resolved || loading}
              className={cn('flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled')}
              onClick={onResolve}
              aria-label='Resolve comment'
            >
              {comment.resolved ? <RiCheckboxCircleFill className='h-4 w-4' /> : <RiCheckboxCircleLine className='h-4 w-4' />}
            </button>
            <Divider type='vertical' className='h-3.5' />
            <button
              type='button'
              disabled={!canGoPrev || loading}
              className={cn('flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled')}
              onClick={onPrev}
              aria-label='Previous comment'
            >
              <RiArrowUpSLine className='h-4 w-4' />
            </button>
            <button
              type='button'
              disabled={!canGoNext || loading}
              className={cn('flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled')}
              onClick={onNext}
              aria-label='Next comment'
            >
              <RiArrowDownSLine className='h-4 w-4' />
            </button>
            <button
              type='button'
              className='flex h-6 w-6 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary'
              onClick={onClose}
              aria-label='Close comment'
            >
              <RiCloseLine className='h-4 w-4' />
            </button>
          </div>
        </div>
        <div className='relative mt-2 flex-1 overflow-y-auto px-4'>
          <ThreadMessage
            authorName={comment.created_by_account?.name || 'User'}
            avatarUrl={comment.created_by_account?.avatar_url || null}
            createdAt={comment.created_at}
            content={comment.content}
          />
          {comment.replies?.length > 0 && (
            <div className='mt-3 space-y-3 pt-3'>
              {comment.replies.map(renderReply)}
            </div>
          )}
        </div>
        {loading && (
          <div className='bg-components-panel-bg/70 absolute inset-0 z-30 flex items-center justify-center text-sm text-text-tertiary'>
            Loading…
          </div>
        )}
        {onReply && (
          <div className='border-t border-components-panel-border px-4 py-3'>
            <div className='flex items-center gap-3'>
              <Avatar
                avatar={userProfile?.avatar_url || null}
                name={userProfile?.name || 'You'}
                size={24}
                className='h-8 w-8'
              />
              <div className='flex-1 rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur p-[2px] shadow-sm'>
                <div className='flex items-center gap-2'>
                  <Textarea
                    ref={textareaRef}
                    minRows={1}
                    maxRows={1}
                    value={replyContent}
                    placeholder='Add a reply'
                    onChange={e => handleContentChange(e.target.value)}
                    onKeyDown={handleReplyKeyDown}
                    className='system-sm-regular h-8 w-full resize-none bg-transparent pl-2 leading-8 text-text-primary caret-primary-500 outline-none'
                  />
                  <button
                    type='button'
                    disabled={loading || mentionLoading}
                    className={cn('z-20 flex h-8 w-8 items-center justify-center rounded-lg bg-components-button-secondary-bg hover:bg-state-base-hover')}
                    onClick={handleMentionButtonClick}
                    aria-label='Mention user'
                  >
                    <RiAtLine className='h-4 w-4' />
                  </button>
                  <Button
                    variant='primary'
                    disabled={loading || !onReply || !replyContent.trim()}
                    onClick={handleReplySubmit}
                    className='z-20 h-8 w-8'
                  >
                    <RiArrowUpLine className='h-4 w-4' />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {showMentionDropdown && filteredMentionUsers.length > 0 && typeof document !== 'undefined' && createPortal(
        <div
          className='fixed z-[9999] max-h-40 w-56 overflow-y-auto rounded-lg border border-components-panel-border bg-white shadow-lg'
          style={{ left: dropdownPosition.x, top: dropdownPosition.y }}
          data-mention-dropdown
        >
          {filteredMentionUsers.map((user, index) => (
            <div
              key={user.id}
              className={cn(
                'flex cursor-pointer items-center gap-2 p-2 hover:bg-state-base-hover',
                index === selectedMentionIndex && 'bg-state-base-hover',
              )}
              onClick={() => insertMention(user)}
            >
              <Avatar
                avatar={user.avatar_url || null}
                name={user.name}
                size={24}
                className='shrink-0'
              />
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm font-medium text-text-primary'>{user.name}</div>
                <div className='truncate text-xs text-text-tertiary'>{user.email}</div>
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
})

CommentThread.displayName = 'CommentThread'
