'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import Button from '../button'

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
    <div className={cn('w-[320px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg px-3 pb-4 pt-3.5 shadow-xl', className)}>
      {beforeHeader || null}
      <div className="mb-1 flex h-6 items-center justify-between">
        <div className="text-text-primary system-xl-semibold">{title}</div>
        {!hideCloseBtn && (
          <div
            className="cursor-pointer p-1.5 text-text-tertiary"
            onClick={onClose}
          >
            <span className="i-ri-close-line size-4" data-testid="modal-close-btn" />
          </div>
        )}
      </div>
      <div className="mt-2">{children}</div>
      <div className="mt-4 flex justify-end">
        <Button
          className="mr-2"
          onClick={onClose}
        >
          {t('operation.cancel', { ns: 'common' })}
        </Button>
        <Button
          onClick={onConfirm}
          variant="primary"
        >
          {t('operation.save', { ns: 'common' })}
        </Button>
      </div>
    </div>
  )
}

export default React.memo(ModalLikeWrap)
