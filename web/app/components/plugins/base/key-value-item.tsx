'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import copy from 'copy-to-clipboard'
import { useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  label: string
  labelWidthClassName?: string
  value: string
  maskedValue?: string
  valueMaxWidthClassName?: string
}>

function KeyValueItem({
  label,
  labelWidthClassName = 'w-10',
  value,
  maskedValue,
  valueMaxWidthClassName = 'max-w-[162px]',
}: Props) {
  const { t } = useTranslation()
  const [isCopied, setIsCopied] = useState(false)
  const labelId = useId()
  const handleCopy = useCallback(() => {
    copy(value)
    setIsCopied(true)
  }, [value])

  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => {
        setIsCopied(false)
      }, 2000)
      return () => {
        clearTimeout(timer)
      }
    }
  }, [isCopied])

  const copiedLabel = t(($) => $['operation.copied'], { ns: 'common' })
  const copyLabel = t(($) => $['operation.copy'], { ns: 'common' })
  const copyButtonLabel = `${copyLabel}: ${label}`
  const copyStatus = `${copiedLabel}: ${label}`
  const tooltipLabel = isCopied ? copiedLabel : copyLabel

  return (
    <div role="group" aria-labelledby={labelId} className="flex items-center gap-1">
      <span
        id={labelId}
        className={cn(
          'flex flex-col items-start justify-center system-xs-medium text-text-tertiary',
          labelWidthClassName,
        )}
      >
        {label}
      </span>
      <div className="flex items-center justify-center gap-0.5">
        <span
          className={cn(valueMaxWidthClassName, 'truncate system-xs-medium text-text-secondary')}
        >
          {maskedValue || value}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <IconButton aria-label={copyButtonLabel} onClick={handleCopy}>
                {isCopied ? (
                  <span
                    aria-hidden
                    className="i-custom-vender-line-files-copy-check size-3.5 shrink-0 text-text-tertiary"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="i-ri-clipboard-line size-3.5 shrink-0 text-text-tertiary"
                  />
                )}
              </IconButton>
            }
          />
          <TooltipContent placement="top">{tooltipLabel}</TooltipContent>
        </Tooltip>
      </div>
      <span role="status" aria-atomic="true" className="sr-only">
        {isCopied ? copyStatus : ''}
      </span>
    </div>
  )
}

export default KeyValueItem
