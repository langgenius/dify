import type { ComponentProps, MouseEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'
import { highlightMentions } from './mention-highlight'

/** The rounded input box around a comment composer. */
export function CommentComposerFrame({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur p-1 shadow-md backdrop-blur-[5px]',
        className,
      )}
      {...props}
    />
  )
}

type CommentComposerActionsProps = {
  canSend: boolean
  sending?: boolean
  onSend?: (event: MouseEvent<HTMLButtonElement>) => void
  mentionDisabled?: boolean
  onMention?: (event: MouseEvent<HTMLButtonElement>) => void
}

/** The @ and send buttons at the end of a single-line composer. */
export function CommentComposerActions({
  canSend,
  sending = false,
  onSend,
  mentionDisabled,
  onMention,
}: CommentComposerActionsProps) {
  const { t } = useTranslation(['common', 'workflowAgent'])

  return (
    <div className="flex shrink-0 items-center gap-2 self-end">
      <IconButton
        aria-label={t(($) => $['nodes.agent.task.mention'], { ns: 'workflowAgent' })}
        size="lg"
        disabled={mentionDisabled}
        className="transition-opacity data-disabled:opacity-40"
        onClick={onMention}
      >
        <span aria-hidden className="i-ri-at-line size-4 text-text-tertiary" />
      </IconButton>
      <IconButton
        aria-label={t(($) => $['operation.send'], { ns: 'common' })}
        size="lg"
        variant="primary"
        disabled={!canSend || sending}
        onClick={onSend}
      >
        {sending ? (
          <span
            aria-hidden
            className="i-ri-loader-2-line size-4 animate-spin text-components-button-primary-text"
          />
        ) : (
          <span
            aria-hidden
            className="i-ri-arrow-up-line size-4 text-components-button-primary-text"
          />
        )}
      </IconButton>
    </div>
  )
}

type CommentComposerPreviewProps = {
  value: string
  placeholder?: string
  /** Names that render as highlighted @mentions inside `value`. */
  mentionNames?: string[]
  /** Put the actions below the text, as the live composer does once text wraps. */
  stacked?: boolean
  sending?: boolean
}

/**
 * A read-only rendering of the single-line comment composer, for showing a
 * draft being typed without the editing and mention machinery.
 */
export function CommentComposerPreview({
  value,
  placeholder,
  mentionNames = [],
  stacked = false,
  sending,
}: CommentComposerPreviewProps) {
  return (
    <div
      className={cn(
        'relative flex body-sm-regular leading-4.5 pointer-coarse:text-base pointer-coarse:leading-6',
        stacked ? 'flex-col gap-1' : 'items-end',
      )}
    >
      <div className="min-w-0 flex-1 px-2 py-1.75 wrap-break-word whitespace-pre-wrap">
        {value ? (
          <span className="text-text-secondary">{highlightMentions(value, mentionNames)}</span>
        ) : (
          <span className="text-components-input-text-placeholder">{placeholder}</span>
        )}
      </div>
      <CommentComposerActions canSend={Boolean(value.trim())} sending={sending} mentionDisabled />
    </div>
  )
}
