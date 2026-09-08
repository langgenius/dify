'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { usePrefetchQuery, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/client'
import PlanComp from '../plan'

const Billing: FC = () => {
  const { t } = useTranslation()
  const isCurrentWorkspaceManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  usePrefetchQuery(consoleQuery.features.vectorSpace.get.queryOptions())
  const { data: billing } = useQuery(
    consoleQuery.billing.invoices.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD' && isCurrentWorkspaceManager,
    }),
  )
  const billingUrl = billing?.url

  return (
    <div>
      <div className="grid min-h-132 xl:min-h-120">
        <React.Suspense
          fallback={
            <Loading className="rounded-2xl border-[0.5px] border-effects-highlight-lightmode-off bg-background-section-burn" />
          }
        >
          <PlanComp loc="billing-page" />
        </React.Suspense>
      </div>
      {deploymentEdition === 'CLOUD' && isCurrentWorkspaceManager && (
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
