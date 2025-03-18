'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'
import { useTranslation } from 'react-i18next'
import Button from '../button'
import { RiCloseLine } from '@remixicon/react'

type Props = {
  title: string
  className?: string
  beforeHeader?: React.ReactNode
  onClose: () => void
  hideCloseBtn?: boolean
  onConfirm: () => void
  children: React.ReactNode
}

const ModalLikeWrap: FC<Props> = ({
  title,
  className,
  beforeHeader,
  children,
  onClose,
  hideCloseBtn,
  onConfirm,
}) => {
  const { t } = useTranslation()

  return (
    <div className={cn('w-[320px] px-3 pt-3.5 pb-4 bg-components-panel-bg shadow-xl rounded-2xl border-[0.5px] border-components-panel-border', className)}>
      {beforeHeader || null}
      <div className='mb-1 flex h-6 items-center justify-between'>
        <div className='system-xl-semibold text-text-primary'>{title}</div>
        {!hideCloseBtn && (
          <div
            className='p-1.5 text-text-tertiary cursor-pointer'
            onClick={onClose}
          >
            <RiCloseLine className='size-4' />
          </div>
        )}
      </div>
      <div className='mt-2'>{children}</div>
      <div className='mt-4 flex justify-end'>
        <Button
          className='mr-2'
          onClick={onClose}>{t('common.operation.cancel')}</Button>
        <Button
          onClick={onConfirm}
          variant='primary'
        >{t('common.operation.save')}</Button>
      </div>
    </div>
  )
}

export default React.memo(ModalLikeWrap)
