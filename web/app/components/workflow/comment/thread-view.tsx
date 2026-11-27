import type { PopoverPopupProps } from '@langgenius/dify-ui/popover'
import type { ComponentProps, ReactNode } from 'react'
import type { Collaborator } from '../collaboration/components/collaborator-avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { PopoverClose, PopoverPopup, PopoverTitle } from '@langgenius/dify-ui/popover'
import { CollaboratorAvatar } from '../collaboration/components/collaborator-avatar'
import { CommentComposerFrame } from './comment-composer'
import { highlightMentions } from './mention-highlight'

type CommentThreadPopupProps = Omit<PopoverPopupProps, 'title' | 'children' | 'render'> & {
  title: ReactNode
  closeLabel: string
  /** Header buttons placed before the close button. */
  actions?: ReactNode
  /** The thread body, usually a `CommentThreadList` and a `CommentReplyBar`. */
  children?: ReactNode
}

/**
 * The comment thread popup: a header with the title, `actions` and a close
 * button, then the body. Compose it in a dify-ui `Popover` whose positioner
 * spreads `commentThreadPlacement`; the close button closes that popover.
 */
export function CommentThreadPopup({
  title,
  closeLabel,
  actions,
  className,
  children,
  ...props
}: CommentThreadPopupProps) {
  return (
    <PopoverPopup
      className={cn(
        'relative flex max-h-100 w-90 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl backdrop-blur-[5px] transition-none',
        className,
      )}
      {...props}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-divider-subtle py-1 ps-4 pe-2">
        <PopoverTitle className="system-sm-semibold text-text-primary uppercase">
          {title}
        </PopoverTitle>
        <div className="flex items-center">
          {actions}
          <PopoverClose
            render={
              <IconButton size="lg" aria-label={closeLabel}>
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
        </div>
      </div>
      {children}
    </PopoverPopup>
  )
}

/** The scrolling message list of a thread. */
export function CommentThreadList({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('relative min-h-0 flex-1 overflow-y-auto', className)} {...props} />
}

/** One row of a thread; reveals a row action menu placed inside it on hover. */
export function CommentThreadItem({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'group relative py-3 ps-4 pe-3 transition-colors hover:bg-components-panel-on-panel-item-bg-hover',
        className,
      )}
      {...props}
    />
  )
}

type CommentMessageProps = {
  author: Collaborator
  /** Relative time, for example "3 minutes ago". */
  timeLabel: string
  content: string
  /** Names that render as highlighted @mentions inside `content`. */
  mentionNames?: string[]
  className?: string
}

export function CommentMessage({
  author,
  timeLabel,
  content,
  mentionNames = [],
  className,
}: CommentMessageProps) {
  return (
    <div className={cn('flex gap-3', className)}>
      <CollaboratorAvatar size="sm" collaborator={author} className="shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-1">
          <span className="system-sm-medium text-text-primary">{author.name}</span>
          <span className="system-xs-regular text-text-tertiary">{timeLabel}</span>
        </div>
        <div className="body-sm-regular leading-4.5 wrap-break-word whitespace-pre-wrap text-text-secondary">
          {highlightMentions(content, mentionNames)}
        </div>
      </div>
    </div>
  )
}

type CommentReplyBarProps = {
  author: Collaborator
  /** The composer, for example `MentionInput`. */
  children: ReactNode
}

/** The thread footer: the replying user's avatar beside the composer box. */
export function CommentReplyBar({ author, children }: CommentReplyBarProps) {
  return (
    <div className="shrink-0 border-t-[0.5px] border-divider-subtle bg-linear-to-b from-background-gradient-bg-fill-chat-bg-1 to-background-gradient-bg-fill-chat-bg-2 py-3 ps-4 pe-3">
      <div className="flex items-start gap-3">
        <div className="shrink-0 py-2">
          <CollaboratorAvatar size="sm" collaborator={author} />
        </div>
        <CommentComposerFrame className="min-w-0 flex-1">{children}</CommentComposerFrame>
      </div>
    </div>
  )
}
