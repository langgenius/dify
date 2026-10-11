'use client'
import type { IconButtonProps } from '@langgenius/dify-ui/icon-button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useClipboard } from 'foxact/use-clipboard'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type CopyFeedbackProps = Readonly<
  Pick<IconButtonProps, 'ref'> & {
    content: string
    className?: string
    copiedLabel?: string
    copyLabel?: string
    disabled?: boolean
    onCopyError?: () => void
    size?: IconButtonProps['size']
    variant?: IconButtonProps['variant']
  }
>

export function CopyFeedback({
  ref,
  content,
  className,
  copiedLabel,
  copyLabel,
  disabled,
  onCopyError,
  size,
  variant,
}: CopyFeedbackProps) {
  const { t } = useTranslation(['common'])
  // Rely on useClipboard's own timer to flip `copied` back to false so the
  // "Copied" tooltip stays visible long enough to be read, matching the
  // KeyValueItem pattern. Do NOT reset on mouse leave.
  const { copied, copy } = useClipboard({ timeout: 2000, onCopyError })

  const tooltipText = copied
    ? (copiedLabel ?? t(($) => $['operation.copied'], { ns: 'common' }))
    : (copyLabel ?? t(($) => $['operation.copy'], { ns: 'common' }))
  /* v8 ignore next -- i18n test mock always returns a non-empty string; runtime fallback is defensive. -- @preserve */
  const safeText = tooltipText || ''

  const handleCopy = useCallback(() => {
    void copy(content)
  }, [copy, content])

  return (
    <Tooltip>
      <TooltipTrigger
        closeOnClick={false}
        render={
          <IconButton
            ref={ref}
            aria-label={safeText}
            className={className}
            disabled={disabled}
            size={size}
            variant={variant}
            onClick={handleCopy}
          >
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
