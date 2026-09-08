'use client'

import type { AccessControlDraft } from './draft'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import PremiumBadge from '@/app/components/base/premium-badge'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { useModalContext } from '@/context/modal-context'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { useAppWorkflow } from '@/service/use-workflow'
import { getPublishedWorkflowState, isAdvancedApp } from '../shared/utils'
import { AccessControlConfigPanel } from './config-panel'
import { createDefaultAccessControlDraft, getAccessControlScopeAvailability } from './draft'
import { AccessControlFreePaywall } from './free-paywall'
import { AccessControlStatusPanel } from './status-panel'

type GtagHandler = (command: 'event', action: 'click_upgrade_btn', payload: { loc: string }) => void

const isPaidCloudPlan = (plan: string | undefined) => plan === 'professional' || plan === 'team'

export function AccessControlEntry() {
  const { t } = useTranslation()
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: plan } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.billing.subscription.plan,
    }),
  )
  const { setShowPricingModal } = useModalContext()
  const [, setSettingsDestination] = useQueryState(settingsQueryParamName, settingsQueryParser)
  const appInfo = useAppStore((state) => state.appDetail)
  const isSandbox = plan === 'sandbox'
  const isPaid = isPaidCloudPlan(plan)
  const shouldFetchWorkflow = isPaid && Boolean(appInfo && isAdvancedApp(appInfo))
  const { data: workflow } = useAppWorkflow(shouldFetchWorkflow && appInfo ? appInfo.id : '')
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'config' | 'status'>('config')
  const [showBack, setShowBack] = useState(false)
  const [draft, setDraft] = useState<AccessControlDraft>(createDefaultAccessControlDraft)
  const [savedDraft, setSavedDraft] = useState<AccessControlDraft | null>(null)

  if (deploymentEdition !== 'CLOUD' || (!isSandbox && !isPaid)) return null

  const label = t(($) => $['studio.accessControl.entryLabel'], { ns: 'deployments' })
  const pro = t(($) => $['studio.accessControl.proBadge'], { ns: 'deployments' })
  const workflowState = appInfo ? getPublishedWorkflowState(appInfo, workflow) : undefined
  const availability = getAccessControlScopeAvailability({
    mode: appInfo?.mode,
    hasTriggerNode: Boolean(workflowState?.hasTriggerNode),
    isUnpublished: Boolean(workflowState?.isUnpublished),
  })
  const policies = [] as const

  const handleTurnOn = () => {
    setShowPricingModal()
    const gtag = (window as Window & { gtag?: GtagHandler }).gtag
    if (gtag) gtag('event', 'click_upgrade_btn', { loc: 'access-control-paywall' })
  }

  const resetDraft = () => {
    setDraft(savedDraft ?? createDefaultAccessControlDraft())
  }

  const handleCancel = () => {
    resetDraft()
    if (savedDraft) {
      setView('status')
      setShowBack(false)
      return
    }
    setOpen(false)
  }

  const handleCreatePolicy = () => {
    setOpen(false)
    void setSettingsDestination('ip-policies')
  }

  const handleSave = () => {
    setSavedDraft(draft)
    setView('status')
    setShowBack(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border-[0.5px] border-divider-deep px-2.5 shadow-xs outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid">
        <span aria-hidden className="i-ri-shield-keyhole-line size-4 text-text-secondary" />
        <span className="system-sm-medium text-text-secondary">{label}</span>
        {isSandbox && (
          <PremiumBadge size="s" color="blue">
            <span
              aria-hidden
              className="i-custom-public-common-sparkles-soft flex h-3.5 w-3.5 items-center py-px pl-0.75 text-components-premium-badge-indigo-text-stop-0"
            />
            <span className="system-xs-medium">{pro}</span>
          </PremiumBadge>
        )}
      </PopoverTrigger>
      <PopoverContent
        placement="bottom-end"
        className="w-100 rounded-2xl border-divider-regular p-0 backdrop-blur-[5px] transition-none data-starting-style:scale-100 data-starting-style:opacity-100"
      >
        {isSandbox ? (
          <AccessControlFreePaywall onTurnOn={handleTurnOn} />
        ) : view === 'status' && savedDraft ? (
          <AccessControlStatusPanel
            draft={savedDraft}
            policies={policies}
            enabled
            availability={availability}
            onEdit={() => {
              setDraft(savedDraft)
              setShowBack(true)
              setView('config')
            }}
          />
        ) : (
          <AccessControlConfigPanel
            draft={draft}
            policies={policies}
            availability={availability}
            showBack={showBack}
            onBack={handleCancel}
            onCancel={handleCancel}
            onCreatePolicy={handleCreatePolicy}
            onManagePolicies={handleCreatePolicy}
            onDraftChange={setDraft}
            onSave={handleSave}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
