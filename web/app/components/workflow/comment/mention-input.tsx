'use client'

import type { FC, ReactNode } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { RiArrowUpLine, RiAtLine } from '@remixicon/react'
import Textarea from 'react-textarea-autosize'
import Button from '@/app/components/base/button'
import Avatar from '@/app/components/base/avatar'
import cn from '@/utils/classnames'
import { type UserProfile, fetchMentionableUsers } from '@/service/workflow-comment'
import { useStore, useWorkflowStore } from '../store'

type MentionInputProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: (content: string, mentionedUserIds: string[]) => void
  onCancel?: () => void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  className?: string
  isEditing?: boolean
  autoFocus?: boolean
}

export const MentionInput: FC<MentionInputProps> = memo(({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
  disabled = false,
  loading = false,
  className,
  isEditing = false,
  autoFocus = false,
}) => {
  const params = useParams()
  const { t } = useTranslation()
  const appId = params.appId as string
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const workflowStore = useWorkflowStore()
  const mentionUsersFromStore = useStore(state => (
    appId ? state.mentionableUsersCache[appId] : undefined
  ))
  const mentionUsers = mentionUsersFromStore ?? []

  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionPosition, setMentionPosition] = useState(0)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([])
  const resolvedPlaceholder = placeholder ?? t('workflow.comments.placeholder.add')

  const mentionNameList = useMemo(() => {
    const names = mentionUsers
      .map(user => user.name?.trim())
      .filter((name): name is string => Boolean(name))

    const uniqueNames = Array.from(new Set(names))
    uniqueNames.sort((a, b) => b.length - a.length)
    return uniqueNames
  }, [mentionUsers])

  const highlightedValue = useMemo<ReactNode>(() => {
    if (!value)
      return ''

    if (mentionNameList.length === 0)
      return value

    const segments: ReactNode[] = []
    let cursor = 0
    let hasMention = false

    while (cursor < value.length) {
      let nextMatchStart = -1
      let matchedName = ''

      for (const name of mentionNameList) {
        const searchStart = value.indexOf(`@${name}`, cursor)
        if (searchStart === -1)
          continue

        const previousChar = searchStart > 0 ? value[searchStart - 1] : ''
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
        segments.push(<span key={`text-${cursor}`}>{value.slice(cursor, nextMatchStart)}</span>)

      const mentionEnd = nextMatchStart + matchedName.length + 1
      segments.push(
        <span key={`mention-${nextMatchStart}`} className='text-primary-600'>
          {value.slice(nextMatchStart, mentionEnd)}
        </span>,
      )

      hasMention = true
      cursor = mentionEnd
    }

    if (!hasMention)
      return value

    if (cursor < value.length)
      segments.push(<span key={`text-${cursor}`}>{value.slice(cursor)}</span>)

    return segments
  }, [value, mentionNameList])

  const loadMentionableUsers = useCallback(async () => {
    if (!appId)
      return

    const state = workflowStore.getState()
    if (state.mentionableUsersCache[appId] !== undefined)
      return

    if (state.mentionableUsersLoading[appId])
      return

    state.setMentionableUsersLoading(appId, true)
    try {
      const users = await fetchMentionableUsers(appId)
      workflowStore.getState().setMentionableUsersCache(appId, users)
    }
    catch (error) {
      console.error('Failed to load mentionable users:', error)
    }
    finally {
      workflowStore.getState().setMentionableUsersLoading(appId, false)
    }
  }, [appId, workflowStore])

  useEffect(() => {
    loadMentionableUsers()
  }, [loadMentionableUsers])

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

  const handleContentChange = useCallback((newValue: string) => {
    onChange(newValue)

    setTimeout(() => {
      const cursorPosition = textareaRef.current?.selectionStart || 0
      const textBeforeCursor = newValue.slice(0, cursorPosition)
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
  }, [onChange])

  const handleMentionButtonClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPosition = textarea.selectionStart || 0
    const newContent = `${value.slice(0, cursorPosition)}@${value.slice(cursorPosition)}`

    onChange(newContent)

    setTimeout(() => {
      const newCursorPos = cursorPosition + 1
      textarea.setSelectionRange(newCursorPos, newCursorPos)
      textarea.focus()

      setMentionQuery('')
      setMentionPosition(cursorPosition)
      setShowMentionDropdown(true)
      setSelectedMentionIndex(0)
    }, 0)
  }, [value, onChange])

  const insertMention = useCallback((user: UserProfile) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const beforeMention = value.slice(0, mentionPosition)
    const afterMention = value.slice(textarea.selectionStart || 0)
    const newContent = `${beforeMention}@${user.name} ${afterMention}`

    onChange(newContent)
    setShowMentionDropdown(false)

    const newMentionedUserIds = [...mentionedUserIds, user.id]
    setMentionedUserIds(newMentionedUserIds)

    setTimeout(() => {
      const newCursorPos = mentionPosition + user.name.length + 2 // @ + name + space
      textarea.setSelectionRange(newCursorPos, newCursorPos)
      textarea.focus()
    }, 0)
  }, [value, mentionPosition, onChange, mentionedUserIds])

  const handleSubmit = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }

    if (value.trim()) {
      onSubmit(value.trim(), mentionedUserIds)
      setMentionedUserIds([])
      setShowMentionDropdown(false)
    }
  }, [value, mentionedUserIds, onSubmit])

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

  const resetMentionState = useCallback(() => {
    setMentionedUserIds([])
    setShowMentionDropdown(false)
    setMentionQuery('')
    setMentionPosition(0)
    setSelectedMentionIndex(0)
  }, [])

  useEffect(() => {
    if (!value)
      resetMentionState()
  }, [value, resetMentionState])

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      const textarea = textareaRef.current
      setTimeout(() => {
        textarea.focus()
        const length = textarea.value.length
        textarea.setSelectionRange(length, length)
      }, 0)
    }
  }, [autoFocus])

  return (
    <>
      <div className={cn('relative flex items-center', className)}>
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 z-0 overflow-hidden whitespace-pre-wrap break-words p-1 leading-6',
            'body-lg-regular text-text-primary',
          )}
        >
          {highlightedValue}
          {'​'}
        </div>
        <Textarea
          ref={textareaRef}
          className={cn(
            'body-lg-regular relative z-10 w-full resize-none bg-transparent p-1 leading-6 text-transparent caret-primary-500 outline-none',
            'placeholder:text-text-tertiary',
          )}
          placeholder={resolvedPlaceholder}
          autoFocus={autoFocus}
          minRows={isEditing ? 4 : 1}
          maxRows={4}
          value={value}
          disabled={disabled || loading}
          onChange={e => handleContentChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        {!isEditing && (
          <div className="absolute bottom-0 right-1 z-20 flex items-end gap-1">
            <div
              className="z-20 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover"
              onClick={handleMentionButtonClick}
            >
              <RiAtLine className="h-4 w-4 text-components-button-primary-text" />
            </div>
            <Button
              className='z-20 ml-2 w-8 px-0'
              variant='primary'
              disabled={!value.trim() || disabled || loading}
              onClick={handleSubmit}
            >
              <RiArrowUpLine className='h-4 w-4 text-components-button-primary-text' />
            </Button>
          </div>
        )}

        {isEditing && (
          <div className="absolute bottom-0 left-1 right-1 z-20 flex items-end justify-between">
            <div
              className="z-20 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover"
              onClick={handleMentionButtonClick}
            >
              <RiAtLine className="h-4 w-4 text-components-button-primary-text" />
            </div>
            <div className='flex items-center gap-2'>
              <Button variant='secondary' size='small' onClick={onCancel} disabled={loading}>
                {t('common.operation.cancel')}
              </Button>
              <Button
                variant='primary'
                size='small'
                disabled={loading || !value.trim()}
                onClick={() => handleSubmit()}
              >
                {t('common.operation.save')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {showMentionDropdown && filteredMentionUsers.length > 0 && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[9999] max-h-40 w-64 overflow-y-auto rounded-lg border border-components-panel-border bg-components-panel-bg shadow-lg"
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
    </>
  )
})

MentionInput.displayName = 'MentionInput'
