'use client'
import type { FC } from 'react'
import {
  RiArrowRightUpLine,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { useBillingUrl } from '@/service/use-billing'
import PlanComp from '../plan'

const Billing: FC = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()
  const { enableBilling } = useProviderContext()
  const { data: billingUrl, isFetching, refetch } = useBillingUrl(enableBilling && isCurrentWorkspaceManager)
  const openAsyncWindow = useAsyncWindowOpen()

  const handleOpenBilling = async () => {
    await openAsyncWindow(async () => {
      const url = (await refetch()).data
      if (url)
        return url
      return null
    }, {
      immediateUrl: billingUrl,
      features: 'noopener,noreferrer',
      onError: (err) => {
        console.error('Failed to fetch billing url', err)
      },
    })
  }

  return (
    <div>
      <PlanComp loc="billing-page" />
      {enableBilling && isCurrentWorkspaceManager && (
        <button
          type="button"
          className="mt-3 flex w-full items-center justify-between rounded-xl bg-background-section-burn px-4 py-3"
          onClick={handleOpenBilling}
          disabled={isFetching}
        >
          <div className="flex flex-col gap-0.5 text-left">
            <div className="system-md-semibold text-text-primary">{t('viewBillingTitle', { ns: 'billing' })}</div>
            <div className="system-sm-regular text-text-secondary">{t('viewBillingDescription', { ns: 'billing' })}</div>
          </div>
          <span className="inline-flex h-8 w-24 items-center justify-center gap-0.5 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 py-2 text-saas-dify-blue-accessible shadow-[0_1px_2px_rgba(9,9,11,0.05)] backdrop-blur-[5px]">
            <span className="system-sm-medium leading-[1]">{t('viewBillingAction', { ns: 'billing' })}</span>
            <RiArrowRightUpLine className="h-4 w-4" />
          </span>
        </button>
      )}
    </div>
  )
}

export default React.memo(Billing)
