'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import copy from 'copy-to-clipboard'
import {
  RiClipboardLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { CopyCheck } from '../../base/icons/src/vender/line/files'
import Tooltip from '../../base/tooltip'
import cn from '@/utils/classnames'
import ActionButton from '@/app/components/base/action-button'

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

  const CopyIcon = isCopied ? CopyCheck : RiClipboardLine

  return (
    <div className='flex items-center gap-1'>
      <span className={cn('system-xs-medium flex flex-col items-start justify-center text-text-tertiary', labelWidthClassName)}>{label}</span>
      <div className='flex items-center justify-center gap-0.5'>
        <span className={cn(valueMaxWidthClassName, ' system-xs-medium truncate text-text-secondary')}>
          {maskedValue || value}
        </span>
        <Tooltip popupContent={t(`common.operation.${isCopied ? 'copied' : 'copy'}`)} position='top'>
          <ActionButton onClick={handleCopy}>
            <CopyIcon className='h-3.5 w-3.5 shrink-0 text-text-tertiary' />
          </ActionButton>
        </Tooltip>
      </div>
    </div>
  )
}

export default React.memo(KeyValueItem)
