'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { CopyCheck } from '../../base/icons/src/vender/line/files'

type Props = {
  label: string
  labelWidthClassName?: string
  value: string
  maskedValue?: string
  valueMaxWidthClassName?: string
}

const KeyValueItem: FC<Props> = ({
  label,
  labelWidthClassName = 'w-10',
  value,
  maskedValue,
  valueMaxWidthClassName = 'max-w-[162px]',
}) => {
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

  const copyLabel = t(`operation.${isCopied ? 'copied' : 'copy'}`, { ns: 'common' })

  return (
    <div className="flex items-center gap-1">
      <span className={cn('flex flex-col items-start justify-center system-xs-medium text-text-tertiary', labelWidthClassName)}>{label}</span>
      <div className="flex items-center justify-center gap-0.5">
        <span className={cn(valueMaxWidthClassName, 'truncate system-xs-medium text-text-secondary')}>
          {maskedValue || value}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={(
              <ActionButton aria-label={copyLabel} onClick={handleCopy}>
                {isCopied
                  ? <CopyCheck aria-hidden className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                  : <span aria-hidden className="i-ri-clipboard-line h-3.5 w-3.5 shrink-0 text-text-tertiary" />}
              </ActionButton>
            )}
          />
          <TooltipContent placement="top">
            {copyLabel}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

export default React.memo(KeyValueItem)
