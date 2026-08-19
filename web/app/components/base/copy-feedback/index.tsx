'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useClipboard } from 'foxact/use-clipboard'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type CopyFeedbackProps = Readonly<{
  content: string
  className?: string
}>

const prefixEmbedded = 'overview.appInfo.embedded'

export function CopyFeedback({ content, className }: CopyFeedbackProps) {
  const { t } = useTranslation()
  // Rely on useClipboard's own timer to flip `copied` back to false so the
  // "Copied" tooltip stays visible long enough to be read, matching the
  // KeyValueItem pattern. Do NOT reset on mouse leave.
  const { copied, copy } = useClipboard({ timeout: 2000 })

  const tooltipText = copied
    ? t(($) => $[`${prefixEmbedded}.copied`], { ns: 'appOverview' })
    : t(($) => $[`${prefixEmbedded}.copy`], { ns: 'appOverview' })
  /* v8 ignore next -- i18n test mock always returns a non-empty string; runtime fallback is defensive. -- @preserve */
  const safeText = tooltipText || ''

  const handleCopy = useCallback(() => {
    copy(content)
  }, [copy, content])

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <IconButton aria-label={safeText} className={className} onClick={handleCopy}>
            <span
              aria-hidden="true"
              className={cn('size-4', copied ? 'i-ri-clipboard-fill' : 'i-ri-clipboard-line')}
            />
          </IconButton>
        }
      />
      <TooltipContent>{safeText}</TooltipContent>
    </Tooltip>
  )
}
