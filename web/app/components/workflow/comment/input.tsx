import type { FC } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Textarea from 'react-textarea-autosize'
import { RiSendPlane2Fill } from '@remixicon/react'
import { useParams } from 'next/navigation'
import { useReactFlow, useViewport } from 'reactflow'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import Avatar from '@/app/components/base/avatar'
import { useAppContext } from '@/context/app-context'
import { type UserProfile, fetchMentionableUsers } from '@/service/workflow-comment'

type CommentInputProps = {
  position: { x: number; y: number }
  onSubmit: (content: string, mentionedUserIds: string[]) => void
  onCancel: () => void
}

export const CommentInput: FC<CommentInputProps> = memo(({ position, onSubmit, onCancel }) => {
  const [content, setContent] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { userProfile } = useAppContext()
  const { flowToScreenPosition } = useReactFlow()
  const viewport = useViewport()
  const params = useParams()
  const appId = params.appId as string

  const [mentionUsers, setMentionUsers] = useState<UserProfile[]>([])
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionPosition, setMentionPosition] = useState(0)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([])

  const screenPosition = useMemo(() => {
    return flowToScreenPosition(position)
  }, [position.x, position.y, viewport.x, viewport.y, viewport.zoom, flowToScreenPosition])

  const loadMentionableUsers = useCallback(async () => {
    if (!appId) return
    try {
      const users = await fetchMentionableUsers(appId)
      setMentionUsers(users)
    }
 catch (error) {
      console.error('Failed to load mentionable users:', error)
    }
  }, [appId])

  useEffect(() => {
    loadMentionableUsers()
  }, [loadMentionableUsers])

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown, true)
    }
  }, [onCancel])

  const filteredMentionUsers = useMemo(() => {
    if (!mentionQuery) return mentionUsers
    return mentionUsers.filter(user =>
      user.name.toLowerCase().includes(mentionQuery.toLowerCase())
      || user.email.toLowerCase().includes(mentionQuery.toLowerCase()),
    )
  }, [mentionUsers, mentionQuery])

  const dropdownPosition = useMemo(() => {
    if (!showMentionDropdown || !textareaRef.current)
      return { x: 0, y: 0 }

    const textareaRect = textareaRef.current.getBoundingClientRect()
    return {
      x: textareaRect.left,
      y: textareaRect.bottom + 4,
    }
  }, [showMentionDropdown])

  const handleContentChange = useCallback((value: string) => {
    setContent(value)

    // Delay getting cursor position to ensure the textarea has updated
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
    console.log('Mention button clicked!')

    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPosition = textarea.selectionStart || 0
    const newContent = `${content.slice(0, cursorPosition)}@${content.slice(cursorPosition)}`

    setContent(newContent)

    setTimeout(() => {
      const newCursorPos = cursorPosition + 1
      textarea.setSelectionRange(newCursorPos, newCursorPos)
      textarea.focus()

      setMentionQuery('')
      setMentionPosition(cursorPosition)
      setShowMentionDropdown(true)
      setSelectedMentionIndex(0)
    }, 0)
  }, [content])

  const insertMention = useCallback((user: UserProfile) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const beforeMention = content.slice(0, mentionPosition)
    const afterMention = content.slice(textarea.selectionStart || 0)
    const newContent = `${beforeMention}@${user.name} ${afterMention}`

    setContent(newContent)
    setShowMentionDropdown(false)
    setMentionedUserIds(prev => [...prev, user.id])

    setTimeout(() => {
      const newCursorPos = mentionPosition + user.name.length + 2 // @ + name + space
      textarea.setSelectionRange(newCursorPos, newCursorPos)
      textarea.focus()
    }, 0)
  }, [content, mentionPosition])

  const handleSubmit = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    console.log('Submit button clicked!')

    try {
      if (content.trim()) {
        onSubmit(content.trim(), mentionedUserIds)
        setContent('')
        setMentionedUserIds([])
      }
    }
    catch (error) {
      console.error('Error in CommentInput handleSubmit:', error)
    }
  }, [content, mentionedUserIds, onSubmit])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showMentionDropdown) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedMentionIndex(prev =>
          prev < filteredMentionUsers.length - 1 ? prev + 1 : 0,
        )
      }
 else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedMentionIndex(prev =>
          prev > 0 ? prev - 1 : filteredMentionUsers.length - 1,
        )
      }
 else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredMentionUsers[selectedMentionIndex])
          insertMention(filteredMentionUsers[selectedMentionIndex])

        return
      }
 else if (e.key === 'Escape') {
        e.preventDefault()
        setShowMentionDropdown(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !showMentionDropdown) {
      e.preventDefault()
      handleSubmit()
    }
  }, [showMentionDropdown, filteredMentionUsers, selectedMentionIndex, insertMention, handleSubmit])

  return (
    <div
      className="absolute z-50 w-96"
      style={{
        left: screenPosition.x,
        top: screenPosition.y,
      }}
      data-comment-input
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <div className="relative h-14 w-14 overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full bg-primary-500">
            <div className="absolute inset-1 overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full bg-white">
              <div className="flex h-full w-full items-center justify-center">
                <div className="h-10 w-10 overflow-hidden rounded-full">
                  <Avatar
                    avatar={userProfile.avatar_url}
                    name={userProfile.name}
                    size={40}
                    className="h-full w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          className={cn(
            'relative z-10 flex-1 rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur pb-[9px] shadow-md',
          )}
        >
          <div className='relative px-[9px] pt-[9px]'>
            <div className='relative'>
              <div className='relative flex w-full grow items-start'>
                <Textarea
                  ref={textareaRef}
                  className={cn(
                    'body-lg-regular relative z-10 w-full resize-none bg-transparent p-1 leading-6 caret-primary-500 outline-none',
                  )}
                  placeholder="Add a comment"
                  autoFocus
                  minRows={1}
                  maxRows={4}
                  value={content}
                  onChange={(e) => {
                    handleContentChange(e.target.value)
                  }}
                  onKeyDown={handleKeyDown}
                />
              </div>
              <div className="absolute bottom-0 right-1 z-20 flex items-end gap-1">
                <div
                  className="z-20 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-components-button-secondary-bg hover:bg-state-base-hover"
                  onClick={handleMentionButtonClick}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M13.3334 8.00004C13.3334 5.05452 10.9456 2.66671 8.00004 2.66671C5.05452 2.66671 2.66671 5.05452 2.66671 8.00004C2.66671 10.9456 5.05452 13.3334 8.00004 13.3334C9.09457 13.3334 10.1121 13.0036 10.9588 12.4381L11.6984 13.5476C10.6402 14.2546 9.36824 14.6667 8.00004 14.6667C4.31814 14.6667 1.33337 11.6819 1.33337 8.00004C1.33337 4.31814 4.31814 1.33337 8.00004 1.33337C11.6819 1.33337 14.6667 4.31814 14.6667 8.00004V9.00004C14.6667 10.2887 13.622 11.3334 12.3334 11.3334C11.5306 11.3334 10.8224 10.9279 10.4026 10.3106C9.79617 10.941 8.94391 11.3334 8.00004 11.3334C6.15909 11.3334 4.66671 9.84097 4.66671 8.00004C4.66671 6.15909 6.15909 4.66671 8.00004 4.66671C8.75057 4.66671 9.44317 4.91477 10.0004 5.33337H11.3334V9.00004C11.3334 9.55231 11.7811 10 12.3334 10C12.8856 10 13.3334 9.55231 13.3334 9.00004V8.00004ZM8.00004 6.00004C6.89544 6.00004 6.00004 6.89544 6.00004 8.00004C6.00004 9.10464 6.89544 10 8.00004 10C9.10464 10 10 9.10464 10 8.00004C10 6.89544 9.10464 6.00004 8.00004 6.00004Z" fill="#676F83"/>
                  </svg>
                </div>
                <Button
                  className='z-20 ml-2 w-8 px-0'
                  variant='primary'
                  disabled={!content.trim()}
                  onClick={handleSubmit}
                >
                  <RiSendPlane2Fill className='h-4 w-4' />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showMentionDropdown && filteredMentionUsers.length > 0 && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[9999] max-h-40 w-64 overflow-y-auto rounded-lg border border-components-panel-border bg-white shadow-lg"
          style={{
            left: dropdownPosition.x,
            top: dropdownPosition.y,
          }}
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
                className="shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text-primary">
                  {user.name}
                </div>
                <div className="truncate text-xs text-text-tertiary">
                  {user.email}
                </div>
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
})

CommentInput.displayName = 'CommentInput'
