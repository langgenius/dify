'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import {
  RiArrowRightUpLine,
} from '@remixicon/react'
import PlanComp from '../plan'
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
          <a
            className='mt-3 flex items-center justify-between rounded-xl bg-background-section-burn px-4 py-3'
            href={billingUrl}
            target='_blank'
            rel='noopener noreferrer'
          >
            <div className='flex flex-col gap-0.5'>
              <div className='system-md-semibold text-text-primary'>{t('billing.viewBillingTitle')}</div>
              <div className='system-sm-regular text-text-secondary'>{t('billing.viewBillingDescription')}</div>
            </div>
            <span className='inline-flex h-8 w-24 items-center justify-center gap-0.5 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 py-2 text-saas-dify-blue-accessible shadow-[0_1px_2px_rgba(9,9,11,0.05)] backdrop-blur-[5px]'>
              <span className='system-sm-medium leading-[1]'>{t('billing.viewBillingAction')}</span>
              <RiArrowRightUpLine className='h-4 w-4' />
            </span>
          </a>
        </>
      )}
    </div>
  )
}

export default React.memo(Billing)
