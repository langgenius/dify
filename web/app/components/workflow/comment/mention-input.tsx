'use client'

import type { UserProfile } from '@/app/components/workflow/comment/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
} from '@langgenius/dify-ui/popover'
import { skipToken, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Textarea from 'react-textarea-autosize'
import { editorAppIdAtom } from '@/app/components/workflow/editor-resource/state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'
import { CollaboratorAvatar } from '../collaboration/components/collaborator-avatar'
import { CommentComposerActions } from './comment-composer'
import { highlightMentions } from './mention-highlight'
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
    const { data: currentUserId } = useSuspenseQuery({
      ...userProfileQueryOptions(),
      select: (data) => data.profile.id,
    })
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const highlightContentRef = useRef<HTMLDivElement>(null)
    const lineProbeRef = useRef<HTMLDivElement>(null)
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
    const mentionUsers = useMemo(() => mentionableUsers ?? EMPTY_USERS, [mentionableUsers])

    const [showMentionDropdown, setShowMentionDropdown] = useState(false)
    const [mentionQuery, setMentionQuery] = useState('')
    const [mentionPosition, setMentionPosition] = useState(0)
    const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
    const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([])
    const resolvedPlaceholder =
      placeholder ?? t(($) => $['comments.placeholder.add'], { ns: 'workflowComments' })
    const [isMultiline, setIsMultiline] = useState(false)

    const mentionNameList = useMemo(() => {
      const names = mentionUsers
        .map((user) => user.name?.trim())
        .filter((name): name is string => Boolean(name))

      const uniqueNames = Array.from(new Set(names))
      uniqueNames.sort((a, b) => b.length - a.length)
      return uniqueNames
    }, [mentionUsers])

    const highlightedValue = useMemo(
      () => highlightMentions(value, mentionNameList),
      [value, mentionNameList],
    )

    const syncHighlightScroll = useCallback(() => {
      const textarea = textareaRef.current
      const highlightContent = highlightContentRef.current
      if (!textarea || !highlightContent) return

      const { scrollTop, scrollLeft } = textarea
      highlightContent.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`
    }, [])

    useLayoutEffect(() => {
      syncHighlightScroll()
    }, [value, syncHighlightScroll])

    useEffect(() => {
      const probe = lineProbeRef.current
      if (!probe || isEditing) return
      const observer = new ResizeObserver(() => {
        const { lineHeight, paddingTop, paddingBottom } = getComputedStyle(probe)
        const contentHeight =
          probe.offsetHeight - Number.parseFloat(paddingTop) - Number.parseFloat(paddingBottom)
        setIsMultiline(contentHeight > Number.parseFloat(lineHeight) * 1.5)
      })
      observer.observe(probe)
      return () => observer.disconnect()
    }, [isEditing])

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
          window.requestAnimationFrame(syncHighlightScroll)
        }, 0)
      },
      [onChange, syncHighlightScroll],
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
          window.requestAnimationFrame(syncHighlightScroll)
        }, 0)
      },
      [value, onChange, syncHighlightScroll, showMentionDropdown],
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
          window.requestAnimationFrame(syncHighlightScroll)
        }, 0)
      },
      [value, mentionPosition, onChange, mentionedUserIds, syncHighlightScroll],
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

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        // Ignore key events during IME composition (e.g., Chinese, Japanese input)
        if (e.nativeEvent.isComposing) return

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
        <div
          ref={rootRef}
          className={cn(
            'relative flex body-sm-regular leading-4.5 pointer-coarse:text-base pointer-coarse:leading-6',
            isEditing || isMultiline ? 'flex-col gap-1' : 'items-end',
            className,
          )}
        >
          <div className="relative min-w-0 flex-1">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden px-2 py-1.75 wrap-break-word whitespace-pre-wrap text-text-secondary"
            >
              <div ref={highlightContentRef} className="min-h-full will-change-transform">
                {highlightedValue}
              </div>
            </div>
            <Textarea
              ref={textareaRef}
              className="relative block w-full resize-none bg-transparent px-2 py-1.75 text-transparent caret-primary-500 outline-hidden placeholder:text-components-input-text-placeholder"
              placeholder={resolvedPlaceholder}
              aria-label={resolvedPlaceholder}
              autoFocus={autoFocus}
              minRows={isEditing ? 2 : 1}
              maxRows={isEditing || isMultiline ? 4 : 1}
              value={value}
              disabled={disabled}
              readOnly={locked}
              aria-busy={loading || undefined}
              onChange={(e) => handleContentChange(e.target.value)}
              aria-controls={isMentionMenuOpen ? listboxId : undefined}
              aria-activedescendant={
                isMentionMenuOpen ? `${listboxId}-${selectedMentionIndex}` : undefined
              }
              onKeyDown={handleKeyDown}
              onScroll={syncHighlightScroll}
            />
          </div>
          {!isEditing && (
            <div
              ref={lineProbeRef}
              aria-hidden
              className="pointer-events-none invisible absolute inset-s-0 inset-e-18 top-0 px-2 py-1.75 wrap-break-word whitespace-pre-wrap"
            >
              {`${value}\u200B`}
            </div>
          )}

          {!isEditing && (
            <CommentComposerActions
              canSend={Boolean(value.trim()) && !disabled}
              sending={loading}
              onSend={handleSubmit}
              mentionDisabled={shouldDisableMentionButton}
              onMention={handleMentionButtonClick}
            />
          )}

          {isEditing && (
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
          )}
        </div>

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
                      collaborator={toCommentCollaborator(user, currentUserId)}
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
