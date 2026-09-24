import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'

type ThinkingProps = {
  text?: string | null
  isStreaming?: boolean
  onVisibleContentChange?: () => void
}

const ThinkingDetails = ({
  text,
  isStreaming,
  label,
  onVisibleContentChange,
}: {
  text: string
  isStreaming: boolean
  label: string
  onVisibleContentChange?: () => void
}) => {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open) onVisibleContentChange?.()
  }, [onVisibleContentChange, open, text])

  return (
    <details
      aria-label={label}
      className="group min-h-8"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex h-8 cursor-pointer list-none items-center gap-2 text-[13px] leading-4 font-medium text-text-tertiary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid">
        <span aria-hidden className="i-custom-public-app-builder-thinking size-[18px] shrink-0" />
        <span>{label}</span>
        <span className="grow" />
        <span
          aria-hidden
          className="i-ri-arrow-right-s-line size-4 text-text-tertiary transition-transform group-open:rotate-90"
        />
      </summary>
      {open && (
        <div className="ml-5 border-l border-divider-subtle py-1 pl-3">
          <Markdown
            content={text}
            isAnimating={isStreaming}
            className="text-xs! leading-5! text-text-tertiary!"
          />
        </div>
      )}
    </details>
  )
}

export const Thinking = memo(
  ({ text, isStreaming = false, onVisibleContentChange }: ThinkingProps) => {
    const { t } = useTranslation(['common'])
    if (!text?.trim()) return null
    const label = isStreaming
      ? t(($) => $['chat.thinking'], { ns: 'common' })
      : t(($) => $['chat.thought'], { ns: 'common' })

    return (
      <ThinkingDetails
        text={text}
        isStreaming={isStreaming}
        label={label}
        onVisibleContentChange={onVisibleContentChange}
      />
    )
  },
)
