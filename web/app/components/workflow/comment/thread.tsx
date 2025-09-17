'use client'

import { useParams } from 'next/navigation'

import type { FC } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useReactFlow, useViewport } from 'reactflow'
import { RiArrowDownSLine, RiArrowUpSLine, RiCheckboxCircleFill, RiCheckboxCircleLine, RiCloseLine, RiDeleteBinLine, RiSendPlane2Fill } from '@remixicon/react'
import Textarea from 'react-textarea-autosize'
import Avatar from '@/app/components/base/avatar'
import Button from '@/app/components/base/button'
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
  isReply?: boolean
}> = ({ authorName, avatarUrl, createdAt, content, isReply }) => {
  const { formatTimeFromNow } = useFormatTimeFromNow()

  return (
    <div className={cn('flex gap-3', isReply && 'pt-1')}>
      <div className='shrink-0'>
        <Avatar
          name={authorName}
          avatar={avatarUrl || null}
          size={isReply ? 28 : 32}
          className={cn('rounded-full', isReply ? 'h-7 w-7' : 'h-8 w-8')}
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
    isReply
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
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionPosition, setMentionPosition] = useState(0)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!onReply || !appId) {
      setMentionUsers([])
      return
    }
    const loadMentionUsers = async () => {
      try {
        setMentionUsers(await fetchMentionableUsers(appId))
      }
      catch (error) {
        console.error('Failed to load mention users', error)
      }
    }
    loadMentionUsers()
  }, [appId, onReply])

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

  const handleMentionButtonClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!onReply || loading) return
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
  }, [replyContent])

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
      <div className='relative rounded-2xl border border-components-panel-border bg-components-panel-bg shadow-xl'>
        <div className='flex items-center justify-between rounded-t-2xl px-4 py-3'>
          <div className='system-2xs-semibold uppercase tracking-[0.08em] text-text-tertiary'>Comment</div>
          <div className='flex items-center gap-1'>
            <button
              type='button'
              disabled={loading}
              className={cn('flex h-6 w-6 items-center justify-center rounded-full text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled')}
              onClick={onDelete}
              aria-label='Delete comment'
            >
              <RiDeleteBinLine className='h-4 w-4' />
            </button>
            <button
              type='button'
              disabled={comment.resolved || loading}
              className={cn('flex h-6 w-6 items-center justify-center rounded-full text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled')}
              onClick={onResolve}
              aria-label='Resolve comment'
            >
              {comment.resolved ? <RiCheckboxCircleFill className='h-4 w-4' /> : <RiCheckboxCircleLine className='h-4 w-4' />}
            </button>
            <div className='bg-components-panel-border/80 mx-1 h-4 w-px' />
            <button
              type='button'
              disabled={!canGoPrev || loading}
              className={cn('flex h-6 w-6 items-center justify-center rounded-full text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled')}
              onClick={onPrev}
              aria-label='Previous comment'
            >
              <RiArrowUpSLine className='h-4 w-4' />
            </button>
            <button
              type='button'
              disabled={!canGoNext || loading}
              className={cn('flex h-6 w-6 items-center justify-center rounded-full text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled')}
              onClick={onNext}
              aria-label='Next comment'
            >
              <RiArrowDownSLine className='h-4 w-4' />
            </button>
            <button
              type='button'
              className='flex h-6 w-6 items-center justify-center rounded-full text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary'
              onClick={onClose}
              aria-label='Close comment'
            >
              <RiCloseLine className='h-4 w-4' />
            </button>
          </div>
        </div>
        <div className='relative px-4 pb-4'>
          <ThreadMessage
            authorName={comment.created_by_account?.name || 'User'}
            avatarUrl={comment.created_by_account?.avatar_url || null}
            createdAt={comment.created_at}
            content={comment.content}
          />
          {comment.replies?.length > 0 && (
            <div className='mt-3 space-y-3 border-t border-components-panel-border pt-3'>
              {comment.replies.map(renderReply)}
            </div>
          )}
        </div>
        {loading && (
          <div className='bg-components-panel-bg/70 absolute inset-0 flex items-center justify-center rounded-2xl text-sm text-text-tertiary'>
            Loading…
          </div>
        )}
        {onReply && (
          <div className='border-t border-components-panel-border px-4 py-3'>
            <div className='flex items-start gap-3'>
              <Avatar
                avatar={userProfile?.avatar_url || null}
                name={userProfile?.name || 'You'}
                size={32}
                className='h-8 w-8'
              />
              <div className='flex-1 rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur px-3 py-2 shadow-sm'>
                <div className='flex items-center gap-2'>
                  <Textarea
                    ref={textareaRef}
                    minRows={1}
                    maxRows={1}
                    value={replyContent}
                    placeholder='Add a reply'
                    onChange={e => handleContentChange(e.target.value)}
                    onKeyDown={handleReplyKeyDown}
                    className='system-sm-regular h-6 w-full resize-none bg-transparent text-text-primary caret-primary-500 outline-none'
                  />
                  <button
                    type='button'
                    disabled={!onReply || loading}
                    className={cn('disabled:bg-components-button-secondary-bg/60 z-20 flex h-8 w-8 items-center justify-center rounded-lg bg-components-button-secondary-bg hover:bg-state-base-hover disabled:cursor-not-allowed disabled:text-text-disabled')}
                    onClick={handleMentionButtonClick}
                    aria-label='Mention user'
                  >
                    <svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none'>
                      <path d='M13.3334 8.00004C13.3334 5.05452 10.9456 2.66671 8.00004 2.66671C5.05452 2.66671 2.66671 5.05452 2.66671 8.00004C2.66671 10.9456 5.05452 13.3334 8.00004 13.3334C9.09457 13.3334 10.1121 13.0036 10.9588 12.4381L11.6984 13.5476C10.6402 14.2546 9.36824 14.6667 8.00004 14.6667C4.31814 14.6667 1.33337 11.6819 1.33337 8.00004C1.33337 4.31814 4.31814 1.33337 8.00004 1.33337C11.6819 1.33337 14.6667 4.31814 14.6667 8.00004V9.00004C14.6667 10.2887 13.622 11.3334 12.3334 11.3334C11.5306 11.3334 10.8224 10.9279 10.4026 10.3106C9.79617 10.941 8.94391 11.3334 8.00004 11.3334C6.15909 11.3334 4.66671 9.84097 4.66671 8.00004C4.66671 6.15909 6.15909 4.66671 8.00004 4.66671C8.75057 4.66671 9.44317 4.91477 10.0004 5.33337H11.3334V9.00004C11.3334 9.55231 11.7811 10 12.3334 10C12.8856 10 13.3334 9.55231 13.3334 9.00004V8.00004ZM8.00004 6.00004C6.89544 6.00004 6.00004 6.89544 6.00004 8.00004C6.00004 9.10464 6.89544 10 8.00004 10C9.10464 10 10 9.10464 10 8.00004C10 6.89544 9.10464 6.00004 8.00004 6.00004Z' fill='#676F83' />
                    </svg>
                  </button>
                  <Button
                    variant='primary'
                    disabled={loading || !onReply || !replyContent.trim()}
                    onClick={handleReplySubmit}
                    className='z-20 ml-2 h-8 w-8 px-0'
                  >
                    <RiSendPlane2Fill className='h-4 w-4' />
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
