'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { useBillingUrl } from '@/service/use-billing'
import { BillingPermission, hasPermission } from '@/utils/permission'
import PlanComp from '../plan'

const Billing: FC = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager, workspacePermissionKeys } = useAppContext()
  const { enableBilling } = useProviderContext()
  const canManageBillingSubscription = isCurrentWorkspaceManager && hasPermission(workspacePermissionKeys, BillingPermission.SubscriptionManage)
  const { data: billingUrl, isFetching, refetch } = useBillingUrl(enableBilling && canManageBillingSubscription)
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
    <div className="flex flex-col gap-3 pt-4">
      <PlanComp loc="billing-page" />
      {enableBilling && canManageBillingSubscription && (
        <div className="flex w-full items-center justify-between rounded-xl bg-background-section-burn px-4 py-3">
          <div className="flex flex-col gap-0.5 text-left">
            <div className="system-md-semibold text-text-primary">{t('viewBillingTitle', { ns: 'billing' })}</div>
            <div className="system-sm-regular text-text-secondary">{t('viewBillingDescription', { ns: 'billing' })}</div>
          </div>
          <Button
            type="button"
            variant="secondary-accent"
            size="medium"
            className="gap-0.5 px-3"
            onClick={handleOpenBilling}
            disabled={isFetching}
          >
            <span className="system-sm-medium leading-none">{t('viewBillingAction', { ns: 'billing' })}</span>
            <span className="i-ri-arrow-right-up-line size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

export default React.memo(Billing)
