'use client'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiClipboardFill, RiClipboardLine } from '@remixicon/react'
import { debounce } from 'lodash-es'
import copy from 'copy-to-clipboard'
import type { InputProps } from '../input'
import Tooltip from '../tooltip'
import ActionButton from '../action-button'
import { cn } from '@/utils/classnames'

export type InputWithCopyProps = {
  showCopyButton?: boolean
  copyValue?: string // Value to copy, defaults to input value
  onCopy?: (value: string) => void // Callback when copy is triggered
} & Omit<InputProps, 'showClearIcon' | 'onCopy'> // Remove conflicting props

const prefixEmbedded = 'appOverview.overview.appInfo.embedded'

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
  const [isCopied, setIsCopied] = useState<boolean>(false)
  // Determine what value to copy
  const valueToString = typeof value === 'string' ? value : String(value || '')
  const finalCopyValue = copyValue || valueToString

  const onClickCopy = debounce(() => {
    copy(finalCopyValue)
    setIsCopied(true)
    onCopy?.(finalCopyValue)
  }, 100)

  const onMouseLeave = debounce(() => {
    setIsCopied(false)
  }, 100)

  useEffect(() => {
    if (isCopied) {
      const timeout = setTimeout(() => {
        setIsCopied(false)
      }, 2000)
      return () => {
        clearTimeout(timeout)
      }
    }
  }, [isCopied])

  return (
    <div className={cn('relative w-full', wrapperClassName)}>
      <input
        ref={ref}
        className={cn(
          'w-full appearance-none border border-transparent bg-components-input-bg-normal py-[7px] text-components-input-text-filled caret-primary-600 outline-none placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs',
          'radius-md system-sm-regular px-3',
          showCopyButton && 'pr-8',
          inputProps.disabled && 'cursor-not-allowed border-transparent bg-components-input-bg-disabled text-components-input-text-filled-disabled hover:border-transparent hover:bg-components-input-bg-disabled',
          inputProps.className,
        )}
        value={value}
        {...(({ size: _size, ...rest }) => rest)(inputProps)}
      />
      {showCopyButton && (
        <div
          className="absolute right-2 top-1/2 -translate-y-1/2"
          onMouseLeave={onMouseLeave}
        >
          <Tooltip
            popupContent={
              (isCopied
                ? t(`${prefixEmbedded}.copied`)
                : t(`${prefixEmbedded}.copy`)) || ''
            }
          >
            <ActionButton
              size="xs"
              onClick={onClickCopy}
              className="hover:bg-components-button-ghost-bg-hover"
            >
              {isCopied ? (
                <RiClipboardFill className='h-3.5 w-3.5 text-text-tertiary' />
              ) : (
                <RiClipboardLine className='h-3.5 w-3.5 text-text-tertiary' />
              )}
            </ActionButton>
          </Tooltip>
        </div>
      )}
    </div>
  )
})

InputWithCopy.displayName = 'InputWithCopy'

export default InputWithCopy
