'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import {
  RiArrowRightUpLine,
} from '@remixicon/react'
import PlanComp from '../plan'
import Divider from '@/app/components/base/divider'
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
        <>
          <Divider className='my-4' />
          <a className='flex items-center text-text-accent-light-mode-only system-xs-medium cursor-pointer' href={billingUrl} target='_blank' rel='noopener noreferrer'>
            <span className='pr-0.5'>{t('billing.viewBilling')}</span>
            <RiArrowRightUpLine className='w-4 h-4' />
          </a>
        </>
      )}
    </div>
  )
}

export default React.memo(Billing)
