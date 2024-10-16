'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import copy from 'copy-to-clipboard'

import {
  RiClipboardLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Toast from '../../base/toast'
import ActionButton from '@/app/components/base/action-button'
type Props = {
  label: string
  value: string
}

const KeyValueItem: FC<Props> = ({
  label,
  value,
}) => {
  const { t } = useTranslation()
  const handleCopy = useCallback(() => {
    copy(value)
    Toast.notify({ type: 'success', message: t('common.actionMsg.copySuccessfully') })
  }, [value])

  return (
    <div className='flex items-center gap-1 self-stretch'>
      <span className='flex w-10 flex-col justify-center items-start text-text-tertiary system-xs-medium'>{label}</span>
      <div className='flex justify-center items-center gap-0.5'>
        <span className='system-xs-medium text-text-secondary'>
          {value}
        </span>
        <ActionButton onClick={handleCopy}>
          <RiClipboardLine className='w-3.5 h-3.5 text-text-tertiary' />
        </ActionButton>
      </div>
    </div>
  )
}

export default React.memo(KeyValueItem)
