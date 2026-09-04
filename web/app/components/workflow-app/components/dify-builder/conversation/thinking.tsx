import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'

export const Thinking = ({
  text,
  isStreaming = false,
}: {
  text?: string | null
  isStreaming?: boolean
}) => {
  const { t } = useTranslation()
  if (!text?.trim()) return null

  const label = isStreaming
    ? t(($) => $['chat.thinking'], { ns: 'common' })
    : t(($) => $['chat.thought'], { ns: 'common' })

  return (
    <details aria-label={label} className="group min-h-8">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-2 text-[13px] leading-4 font-medium text-text-tertiary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid">
        <span aria-hidden className="i-custom-public-app-builder-thinking size-[18px] shrink-0" />
        <span>{label}</span>
        <span className="grow" />
        <span
          aria-hidden
          className="i-ri-arrow-right-s-line size-4 text-text-tertiary transition-transform group-open:rotate-90"
        />
      </summary>
      <div className="ml-5 border-l border-divider-subtle py-1 pl-3">
        <Markdown
          content={text}
          isAnimating={isStreaming}
          className="text-xs! leading-5! text-text-tertiary!"
        />
      </div>
    </details>
  )
}
