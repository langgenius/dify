'use client'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import copy from 'copy-to-clipboard'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyCheck } from '../../base/icons/src/vender/line/files'

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

  const copyLabel = t(($) => $[`operation.${isCopied ? 'copied' : 'copy'}`], { ns: 'common' })

  return (
    <div className="flex items-center gap-1">
      <span
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
              <Button
                variant="ghost"
                aria-label={copyLabel}
                className="size-6 p-0"
                onClick={handleCopy}
              >
                {isCopied ? (
                  <CopyCheck aria-hidden className="size-3.5 shrink-0 text-text-tertiary" />
                ) : (
                  <span
                    aria-hidden
                    className="i-ri-clipboard-line size-3.5 shrink-0 text-text-tertiary"
                  />
                )}
              </Button>
            }
          />
          <TooltipContent placement="top">{copyLabel}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

export default KeyValueItem
