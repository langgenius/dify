'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import {
  RiExternalLinkLine,
} from '@remixicon/react'
import PlanComp from '../plan'
import { ReceiptList } from '../../base/icons/src/vender/line/financeAndECommerce'
import { fetchBillingUrl } from '@/service/billing'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'

const Billing: FC = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()
  const { enableBilling } = useProviderContext()
  const { data: billingUrl } = useSWR(
    (!enableBilling || !isCurrentWorkspaceManager) ? null : ['/billing/invoices'],
    () => fetchBillingUrl().then(data => data.url),
  )

  return (
    <div>
      <PlanComp loc={'billing-page'} />
      {enableBilling && isCurrentWorkspaceManager && billingUrl && (
        <a className='mt-5 flex h-12 cursor-pointer items-center justify-between rounded-xl bg-gray-50 px-6' href={billingUrl} target='_blank' rel='noopener noreferrer'>
          <div className='flex items-center'>
            <ReceiptList className='h-4 w-4 text-gray-700' />
            <div className='ml-2 text-sm font-normal text-gray-700'>{t('billing.viewBilling')}</div>
          </div>
          <RiExternalLinkLine className='h-3 w-3' />
        </a>
      )}
    </div>
  )
}

export default React.memo(Billing)
