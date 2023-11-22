'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import PlanComp from '../plan'
import { ReceiptList } from '../../base/icons/src/vender/line/financeAndECommerce'
import { LinkExternal01 } from '../../base/icons/src/vender/line/general'

const Billing: FC = () => {
  const { t } = useTranslation()

  return (
    <div>
      <PlanComp />
      <a className='mt-5 flex px-6 justify-between h-12 items-center bg-gray-50 rounded-xl cursor-pointer' href='TODO' target='_blank'>
        <div className='flex items-center'>
          <ReceiptList className='w-4 h-4 text-gray-700' />
          <div className='ml-2 text-sm font-normal text-gray-700'>{t('billing.viewBilling')}</div>
        </div>
        <LinkExternal01 className='w-3 h-3' />
      </a>
    </div>
  )
}
export default React.memo(Billing)
