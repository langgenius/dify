import type { ComponentProps, MouseEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'

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
