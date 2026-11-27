import type { ComponentProps, MouseEvent, ReactNode, Ref } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMergedRefs } from '@langgenius/dify-ui/use-merged-refs'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

type CommentComposerFieldProps = Omit<
  ComponentProps<'textarea'>,
  'value' | 'rows' | 'children' | 'className'
> & {
  value: string
  /** Names that render as highlighted @mentions in `value`. */
  mentionNames: string[]
  /** Editing a saved comment: at least two lines, with `actions` always below. */
  editing?: boolean
  /** Buttons after the text: beside a single line, below it once the text wraps. */
  actions?: ReactNode
  rootRef?: Ref<HTMLDivElement>
  className?: string
}

/**
 * The text area of a comment composer. It grows with its text up to four lines, highlights
 * @mentions, and moves `actions` below the text once it wraps. Where `field-sizing` is not
 * supported, it keeps a fixed height of one, two or four rows instead.
 */
export function CommentComposerField({
  value,
  mentionNames,
  editing = false,
  actions,
  rootRef,
  className,
  ref,
  onScroll,
  ...props
}: CommentComposerFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mergedRef = useMergedRefs(textareaRef, ref)
  const highlightRef = useRef<HTMLDivElement>(null)
  const [probe, setProbe] = useState<HTMLDivElement | null>(null)
  const [wrapped, setWrapped] = useState(false)
  const multiline = editing || wrapped

  const syncHighlight = () => {
    const textarea = textareaRef.current
    const highlight = highlightRef.current
    if (!textarea || !highlight) return
    highlight.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`
  }

  useLayoutEffect(syncHighlight, [value])

  useEffect(() => {
    if (!probe) return
    const observer = new ResizeObserver(() => {
      const { lineHeight, paddingTop, paddingBottom } = getComputedStyle(probe)
      const contentHeight =
        probe.offsetHeight - Number.parseFloat(paddingTop) - Number.parseFloat(paddingBottom)
      setWrapped(contentHeight > Number.parseFloat(lineHeight) * 1.5)
    })
    observer.observe(probe)
    return () => observer.disconnect()
  }, [probe])

  return (
    <div
      ref={rootRef}
      data-multiline={multiline || undefined}
      data-editing={editing || undefined}
      className={cn(
        'relative flex items-end body-sm-regular leading-4.5 pointer-coarse:text-base pointer-coarse:leading-6',
        'data-multiline:flex-col data-multiline:items-stretch data-multiline:gap-1',
        className,
      )}
    >
      <div className="relative min-w-0 flex-1 py-1.75">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 inset-y-1.75 overflow-hidden px-2 wrap-break-word whitespace-pre-wrap text-text-secondary"
        >
          <div ref={highlightRef} className="min-h-full will-change-transform">
            {highlightMentions(value, mentionNames)}
          </div>
        </div>
        <textarea
          ref={mergedRef}
          value={value}
          rows={editing ? 2 : multiline ? 4 : 1}
          className={cn(
            'relative block field-sizing-content max-h-[1lh] w-full resize-none bg-transparent px-2 py-0 text-transparent caret-primary-500 outline-hidden placeholder:text-components-input-text-placeholder',
            'in-data-editing:min-h-[2lh] in-data-multiline:max-h-[4lh]',
          )}
          onScroll={(event) => {
            syncHighlight()
            onScroll?.(event)
          }}
          {...props}
        />
      </div>
      {!editing && (
        <div
          ref={setProbe}
          aria-hidden
          className="pointer-events-none invisible absolute inset-s-0 inset-e-18 top-0 px-2 py-1.75 wrap-break-word whitespace-pre-wrap"
        >
          {`${value}\u200B`}
        </div>
      )}
      {actions}
    </div>
  )
}
