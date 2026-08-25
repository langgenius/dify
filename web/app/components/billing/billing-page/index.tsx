'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderContext } from '@/context/provider-context'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/client'
import PlanComp from '../plan'

const Billing: FC = () => {
  const { t } = useTranslation()
  const isCurrentWorkspaceManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const { enableBilling } = useProviderContext()
  const canManageBilling = enableBilling && isCurrentWorkspaceManager
  const { data: billing } = useQuery(
    consoleQuery.billing.invoices.get.queryOptions({ enabled: canManageBilling }),
  )
  const billingUrl = billing?.url

  return (
    <div>
      <PlanComp loc="billing-page" />
      {canManageBilling && (
        <a
          className={cn(
            'mt-3 flex w-full items-center justify-between rounded-xl bg-background-section-burn px-4 py-3 outline-hidden',
            billingUrl &&
              'hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          )}
          href={billingUrl}
          target={billingUrl ? '_blank' : undefined}
          rel={billingUrl ? 'noopener noreferrer' : undefined}
        >
          <div className="flex flex-col gap-0.5 text-left">
            <div className="system-md-semibold text-text-primary">
              {t(($) => $.viewBillingTitle, { ns: 'billing' })}
            </div>
            <div className="system-sm-regular text-text-secondary">
              {t(($) => $.viewBillingDescription, { ns: 'billing' })}
            </div>
          </div>
          <span className="inline-flex h-8 w-24 items-center justify-center gap-0.5 rounded-lg bg-components-button-secondary-bg px-3 py-2 text-saas-dify-blue-accessible shadow-[0_1px_2px_rgba(9,9,11,0.05)] inset-ring-[0.5px] inset-ring-components-button-secondary-border backdrop-blur-[5px]">
            <span className="system-sm-medium leading-none">
              {t(($) => $.viewBillingAction, { ns: 'billing' })}
            </span>
            <span className="i-ri-arrow-right-up-line size-4" aria-hidden="true" />
          </span>
        </a>
      )}
    </div>
  )
}

export default React.memo(Billing)
