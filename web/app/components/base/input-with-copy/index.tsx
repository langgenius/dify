'use client'
import type { InputProps } from '../input'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useClipboard } from '@/hooks/use-clipboard'
import ActionButton from '../action-button'
import Tooltip from '../tooltip'

type InputWithCopyProps = {
  showCopyButton?: boolean
  copyValue?: string // Value to copy, defaults to input value
  onCopy?: (value: string) => void // Callback when copy is triggered
} & Omit<InputProps, 'showClearIcon' | 'onCopy'> // Remove conflicting props

const prefixEmbedded = 'overview.appInfo.embedded'

const InputWithCopy = React.forwardRef<HTMLInputElement, InputWithCopyProps>((
  {
    showCopyButton = true,
    copyValue,
    onCopy,
    value,
    wrapperClassName,
    ...inputProps
  },
  ref,
) => {
  const { t } = useTranslation()
  // Determine what value to copy
  const valueToString = typeof value === 'string' ? value : String(value || '')
  const finalCopyValue = copyValue || valueToString

  const { copied, copy, reset } = useClipboard()

  const handleCopy = () => {
    copy(finalCopyValue)
    onCopy?.(finalCopyValue)
  }

  const tooltipText = copied
    ? t(`${prefixEmbedded}.copied`, { ns: 'appOverview' })
    : t(`${prefixEmbedded}.copy`, { ns: 'appOverview' })
  /* v8 ignore next -- i18n test mock always returns a non-empty string; runtime fallback is defensive. -- @preserve */
  const safeTooltipText = tooltipText || ''

  return (
    <div className={cn('relative w-full', wrapperClassName)}>
      <input
        ref={ref}
        className={cn(
          'w-full appearance-none border border-transparent bg-components-input-bg-normal py-[7px] text-components-input-text-filled caret-primary-600 outline-hidden placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs',
          'rounded-lg px-3 system-sm-regular',
          showCopyButton && 'pr-8',
          inputProps.disabled && 'cursor-not-allowed border-transparent bg-components-input-bg-disabled text-components-input-text-filled-disabled hover:border-transparent hover:bg-components-input-bg-disabled',
          inputProps.className,
        )}
        value={value}
        {...(({ size: _size, ...rest }) => rest)(inputProps)}
      />
      {showCopyButton && (
        <div
          className="absolute top-1/2 right-2 -translate-y-1/2"
          onMouseLeave={reset}
          data-testid="copy-button-wrapper"
        >
          <Tooltip
            popupContent={safeTooltipText}
          >
            <ActionButton
              size="xs"
              onClick={handleCopy}
              className="hover:bg-components-button-ghost-bg-hover"
            >
              {copied
                ? (<span className="i-ri-clipboard-fill h-3.5 w-3.5 text-text-tertiary" data-testid="copied-icon" />)
                : (<span className="i-ri-clipboard-line h-3.5 w-3.5 text-text-tertiary" data-testid="copy-icon" />)}
            </ActionButton>
          </Tooltip>
        </div>
      )}
    </div>
  )
})

InputWithCopy.displayName = 'InputWithCopy'

export default InputWithCopy
