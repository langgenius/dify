import type { ComponentProps, ReactNode, Ref } from 'react'
import type { Collaborator } from '../collaboration/components/collaborator-avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'
import { CollaboratorAvatar } from '../collaboration/components/collaborator-avatar'
import { CommentComposerFrame } from './comment-composer'
import { highlightMentions } from './mention-highlight'

type CommentThreadPanelProps = Omit<ComponentProps<'div'>, 'title'> & {
  title: ReactNode
  closeLabel: string
  onClose: () => void
  /** Header buttons placed before the close button. */
  actions?: ReactNode
  /** Scroll container of the message list. */
  listRef?: Ref<HTMLDivElement>
  /** Shown under the list, usually a `CommentReplyBar`. */
  footer?: ReactNode
  /** When set, covers the thread with this busy message. */
  loadingLabel?: string
}

/**
 * The comment thread dialog: header with title and close, a scrolling list of
 * `CommentThreadItem`s, and an optional footer.
 */
export function CommentThreadPanel({
  title,
  closeLabel,
  onClose,
  actions,
  listRef,
  footer,
  loadingLabel,
  className,
  children,
  ...props
}: CommentThreadPanelProps) {
  const titleId = useId()

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      className={cn(
        'relative flex max-h-100 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl backdrop-blur-[5px]',
        className,
      )}
      {...props}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-divider-subtle py-1 ps-4 pe-2">
        <div id={titleId} className="system-sm-semibold text-text-primary uppercase">
          {title}
        </div>
        <div className="flex items-center">
          {actions}
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </button>
        </div>
      </div>
      <div ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
      {loadingLabel && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-components-panel-bg/70 text-sm text-text-tertiary">
          {loadingLabel}
        </div>
      )}
      {footer}
    </div>
  )
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
  /** The composer, for example `MentionInput` or `CommentComposerPreview`. */
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
