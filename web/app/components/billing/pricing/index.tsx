'use client'
import type { FC } from 'react'
import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'

type Props = {
  onCancel: () => void
}

const Pricing: FC<Props> = ({
  onCancel,
}) => {
  const { t } = useTranslation()

  return createPortal(
    <div className='fixed inset-0 p-6 flex justify-center bg-white z-[1000]' onClick={e => e.stopPropagation()}>
      <div>
        <div className='leading-[38px] text-[30px] font-semibold text-gray-900'>
          {t('billing.plansCommon.title')}
        </div>

      </div>
      <div
        className='absolute top-6 right-6 flex items-center justify-center w-10 h-10 bg-black/[0.05] rounded-full backdrop-blur-[2px] cursor-pointer'
        onClick={onCancel}
      >
        <XClose className='w-4 h-4 text-gray-900' />
      </div>
    </div>,
    document.body,
  )
}
export default React.memo(Pricing)
