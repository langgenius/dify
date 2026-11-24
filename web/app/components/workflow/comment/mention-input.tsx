'use client'

import type { UserProfile } from '@/app/components/workflow/comment/types'
import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
} from '@langgenius/dify-ui/popover'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { editorAppIdAtom } from '@/app/components/workflow/editor-resource/state'
import { consoleQuery } from '@/service/console'
import { CollaboratorAvatar } from '../collaboration/components/collaborator-avatar'
import { CommentComposerActions, CommentComposerField } from './comment-composer'
import { toCommentCollaborator } from './participants'

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

const EMPTY_USERS: UserProfile[] = []

const MentionInputInner = forwardRef<HTMLTextAreaElement, MentionInputProps>(
  (
    {
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
    },
    forwardedRef,
  ) => {
    const { t } = useTranslation(['common', 'workflowComments', 'workflowAgent'])
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const rootRef = useRef<HTMLDivElement>(null)
    const listboxId = useId()

    // Expose textarea ref to parent component
    useImperativeHandle(forwardedRef, () => textareaRef.current!, [])

    const appId = useAtomValue(editorAppIdAtom)
    const { data: mentionableUsers } = useQuery(
      consoleQuery.apps.byAppId.workflow.comments.mentionUsers.get.queryOptions({
        input: appId ? { params: { app_id: appId } } : skipToken,
        select: (response) => response.users,
      }),
    )
    const mentionUsers = mentionableUsers ?? EMPTY_USERS

    const [showMentionDropdown, setShowMentionDropdown] = useState(false)
    const [mentionQuery, setMentionQuery] = useState('')
    const [mentionPosition, setMentionPosition] = useState(0)
    const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
    const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([])
    const resolvedPlaceholder =
      placeholder ?? t(($) => $['comments.placeholder.add'], { ns: 'workflowComments' })

    const mentionNameList = useMemo(
      () => mentionUsers.map((user) => user.name ?? ''),
      [mentionUsers],
    )

    const filteredMentionUsers = useMemo(() => {
      if (!mentionQuery) return mentionUsers
      return mentionUsers.filter(
        (user) =>
          user.name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
          user.email.toLowerCase().includes(mentionQuery.toLowerCase()),
      )
    }, [mentionUsers, mentionQuery])

    // A draft that is being saved is frozen: its text, mention button and mention list all
    // stop changing it, and it stays focused so a failed save can be retried from the keyboard.
    const locked = disabled || loading
    const isMentionMenuOpen = !locked && showMentionDropdown && filteredMentionUsers.length > 0

    useEffect(() => {
      if (!isMentionMenuOpen) return
      document
        .getElementById(`${listboxId}-${selectedMentionIndex}`)
        ?.scrollIntoView({ block: 'nearest' })
    }, [isMentionMenuOpen, listboxId, selectedMentionIndex])

    const shouldDisableMentionButton = useMemo(() => {
      if (locked || showMentionDropdown) return true

      const textarea = textareaRef.current
      if (!textarea) return false

      const cursorPosition = textarea.selectionStart || 0
      const textBeforeCursor = value.slice(0, cursorPosition)
      return /@\w*$/.test(textBeforeCursor)
    }, [locked, showMentionDropdown, value])

    const handleContentChange = useCallback(
      (newValue: string) => {
        onChange(newValue)

        setTimeout(() => {
          const cursorPosition = textareaRef.current?.selectionStart || 0
          const textBeforeCursor = newValue.slice(0, cursorPosition)
          const mentionMatch = textBeforeCursor.match(/@(\w*)$/)

          if (mentionMatch) {
            setMentionQuery(mentionMatch[1]!)
            setMentionPosition(cursorPosition - mentionMatch[0].length)
            setShowMentionDropdown(true)
            setSelectedMentionIndex(0)
          } else {
            setShowMentionDropdown(false)
          }
        }, 0)
      },
      [onChange],
    )

    const handleMentionButtonClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()

        const textarea = textareaRef.current
        if (!textarea) return

        const cursorPosition = textarea.selectionStart || 0
        const textBeforeCursor = value.slice(0, cursorPosition)

        if (showMentionDropdown) return

        if (/@\w*$/.test(textBeforeCursor)) return

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
      },
      [value, onChange, showMentionDropdown],
    )

    const insertMention = useCallback(
      (user: UserProfile) => {
        const textarea = textareaRef.current
        if (!textarea) return

        const beforeMention = value.slice(0, mentionPosition)
        const afterMention = value.slice(textarea.selectionStart || 0)

        const needsSpaceBefore = mentionPosition > 0 && !/\s/.test(value[mentionPosition - 1]!)
        const prefix = needsSpaceBefore ? ' ' : ''
        const newContent = `${beforeMention}${prefix}@${user.name} ${afterMention}`

        onChange(newContent)
        setShowMentionDropdown(false)

        const newMentionedUserIds = [...mentionedUserIds, user.id]
        setMentionedUserIds(newMentionedUserIds)

        setTimeout(() => {
          const extraSpace = needsSpaceBefore ? 1 : 0
          const newCursorPos = mentionPosition + extraSpace + user.name.length + 2 // (space) + @ + name + space
          textarea.setSelectionRange(newCursorPos, newCursorPos)
          textarea.focus()
        }, 0)
      },
      [value, mentionPosition, onChange, mentionedUserIds],
    )

    const handleSubmit = useCallback(
      async (e?: React.MouseEvent) => {
        if (e) {
          e.preventDefault()
          e.stopPropagation()
        }
        // Only one submission runs at a time.
        if (loading) return

        if (value.trim()) {
          try {
            // Mention state resets when the owner clears the value, so a draft typed while
            // this one sends keeps its own mentions.
            await onSubmit(value.trim(), mentionedUserIds)
          } catch (error) {
            console.error('Failed to submit', error)
          }
        }
      },
      [loading, value, mentionedUserIds, onSubmit],
    )

    const compositionEndedAtRef = useRef<number | null>(null)
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        // A key during IME composition (Chinese, Japanese, Korean input) confirms or cancels
        // the composition, so it must not send, close or dismiss anything: it stops here.
        // Safari delivers the confirming key after compositionend, with isComposing already
        // false, so a key that comes a moment after the composition ended still counts.
        const compositionEndedAt = compositionEndedAtRef.current
        if (
          e.nativeEvent.isComposing ||
          (compositionEndedAt !== null &&
            Math.abs(e.nativeEvent.timeStamp - compositionEndedAt) < 50)
        ) {
          e.stopPropagation()
          return
        }

        if (isMentionMenuOpen) {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelectedMentionIndex((prev) =>
              prev < filteredMentionUsers.length - 1 ? prev + 1 : 0,
            )
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelectedMentionIndex((prev) =>
              prev > 0 ? prev - 1 : filteredMentionUsers.length - 1,
            )
          } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
            e.preventDefault()
            if (filteredMentionUsers[selectedMentionIndex])
              insertMention(filteredMentionUsers[selectedMentionIndex])

            return
          } else if (e.key === 'Escape') {
            // The mention list is part of this editor, so the editor owns closing it.
            e.preventDefault()
            e.stopPropagation()
            setShowMentionDropdown(false)
            return
          }
        }

        if (e.key === 'Escape' && isEditing && onCancel) {
          e.preventDefault()
          e.stopPropagation()
          // Like the Cancel button, Escape waits for a running save.
          if (!loading) onCancel()
          return
        }

        if (e.key === 'Enter' && !e.shiftKey && !isMentionMenuOpen) {
          e.preventDefault()
          handleSubmit()
        }
      },
      [
        isMentionMenuOpen,
        filteredMentionUsers,
        selectedMentionIndex,
        insertMention,
        handleSubmit,
        isEditing,
        loading,
        onCancel,
      ],
    )

    const resetMentionState = useCallback(() => {
      setMentionedUserIds([])
      setShowMentionDropdown(false)
      setMentionQuery('')
      setMentionPosition(0)
      setSelectedMentionIndex(0)
    }, [])

    useEffect(() => {
      if (!value) {
        Promise.resolve().then(() => {
          resetMentionState()
        })
      }
    }, [value, resetMentionState])

    useEffect(() => {
      if (!autoFocus || !textareaRef.current) return

      const textarea = textareaRef.current
      const timeout = window.setTimeout(() => {
        textarea.focus()
        const length = textarea.value.length
        textarea.setSelectionRange(length, length)
      }, 0)

      return () => window.clearTimeout(timeout)
    }, [autoFocus])

    return (
      <>
        <CommentComposerField
          ref={textareaRef}
          rootRef={rootRef}
          className={className}
          value={value}
          mentionNames={mentionNameList}
          editing={isEditing}
          placeholder={resolvedPlaceholder}
          aria-label={resolvedPlaceholder}
          autoFocus={autoFocus}
          disabled={disabled}
          readOnly={locked}
          aria-busy={loading || undefined}
          onChange={(e) => handleContentChange(e.target.value)}
          aria-controls={isMentionMenuOpen ? listboxId : undefined}
          aria-activedescendant={
            isMentionMenuOpen ? `${listboxId}-${selectedMentionIndex}` : undefined
          }
          onKeyDown={handleKeyDown}
          onCompositionEnd={(e) => {
            compositionEndedAtRef.current = e.nativeEvent.timeStamp
          }}
          actions={
            isEditing ? (
              <div className="flex items-center justify-between">
                <IconButton
                  aria-label={t(($) => $['nodes.agent.task.mention'], { ns: 'workflowAgent' })}
                  size="lg"
                  disabled={shouldDisableMentionButton}
                  className="transition-opacity data-disabled:opacity-40"
                  onClick={handleMentionButtonClick}
                >
                  <span aria-hidden className="i-ri-at-line size-4 text-text-tertiary" />
                </IconButton>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="small" onClick={onCancel} disabled={loading}>
                    {t(($) => $['operation.cancel'], { ns: 'common' })}
                  </Button>
                  <Button
                    variant="primary"
                    size="small"
                    disabled={loading || !value.trim()}
                    onClick={() => handleSubmit()}
                  >
                    {loading && (
                      <span aria-hidden className="i-ri-loader-2-line size-3.5 animate-spin" />
                    )}
                    <span>{t(($) => $['operation.save'], { ns: 'common' })}</span>
                    {!loading && (
                      <span aria-hidden className="i-custom-public-common-enter-key size-4" />
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <CommentComposerActions
                canSend={Boolean(value.trim()) && !disabled}
                sending={loading}
                onSend={handleSubmit}
                mentionDisabled={shouldDisableMentionButton}
                onMention={handleMentionButtonClick}
              />
            )
          }
        />

        <Popover
          open={isMentionMenuOpen}
          onOpenChange={(open) => {
            if (!open) setShowMentionDropdown(false)
          }}
        >
          <PopoverPortal>
            <PopoverPositioner anchor={rootRef} side="bottom" align="start" sideOffset={4}>
              <PopoverPopup
                id={listboxId}
                role="listbox"
                aria-label={t(($) => $['nodes.agent.task.mention'], { ns: 'workflowAgent' })}
                initialFocus={false}
                finalFocus={false}
                data-mention-dropdown
                className="max-h-62 w-70 overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[10px]"
              >
                {filteredMentionUsers.map((user, index) => (
                  <div
                    key={user.id}
                    id={`${listboxId}-${index}`}
                    role="option"
                    aria-selected={index === selectedMentionIndex}
                    tabIndex={-1}
                    className="flex cursor-pointer items-center gap-2 rounded-lg py-1 ps-2 pe-3 hover:bg-state-base-hover aria-selected:bg-state-base-hover"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertMention(user)}
                  >
                    <CollaboratorAvatar
                      size="sm"
                      className="shrink-0"
                      collaborator={toCommentCollaborator(user)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate system-xs-medium text-text-primary">{user.name}</div>
                      <div className="truncate system-xs-regular text-text-tertiary">
                        {user.email}
                      </div>
                    </div>
                  </div>
                ))}
              </PopoverPopup>
            </PopoverPositioner>
          </PopoverPortal>
        </Popover>
      </>
    )
  },
)

MentionInputInner.displayName = 'MentionInputInner'

export const MentionInput = memo(MentionInputInner)
