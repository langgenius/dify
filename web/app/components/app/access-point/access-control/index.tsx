'use client'

import type { AccessControlAssignment } from './chip-status'
import type { AccessControlDraft, AccessControlPolicy } from './draft'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { useModalContext } from '@/context/modal-context'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { useAppWorkflow } from '@/service/use-workflow'
import { getPublishedWorkflowState, isAdvancedApp } from '../shared/utils'
import { AccessControlChipAffix } from './chip-affix'
import { getAccessControlChipState } from './chip-status'
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
  const [view, setView] = useState<'config' | 'status'>('status')
  const [showBack, setShowBack] = useState(false)
  const [draft, setDraft] = useState<AccessControlDraft | null>(null)
  const [savedDraft, setSavedDraft] = useState<AccessControlDraft | null>(null)
  const [enabled, setEnabled] = useState(true)

  if (deploymentEdition !== 'CLOUD' || (!isSandbox && !isPaid)) return null

  const label = t(($) => $['studio.accessControl.entryLabel'], { ns: 'deployments' })
  const workflowState = appInfo ? getPublishedWorkflowState(appInfo, workflow) : undefined
  const availability = getAccessControlScopeAvailability({
    mode: appInfo?.mode,
    hasTriggerNode: Boolean(workflowState?.hasTriggerNode),
    isUnpublished: Boolean(workflowState?.isUnpublished),
  })
  const policies: readonly AccessControlPolicy[] = []
  const resolvedDraft = draft ?? savedDraft ?? createDefaultAccessControlDraft(availability)
  const assignment: AccessControlAssignment | null = savedDraft?.selectedPolicyId
    ? {
        policyId: savedDraft.selectedPolicyId,
        policyName:
          policies.find((policy) => policy.id === savedDraft.selectedPolicyId)?.name ??
          savedDraft.selectedPolicyId,
        scopes: savedDraft.scopes,
        enabled,
      }
    : null
  const chip = getAccessControlChipState({ plan, assignment, availability })
  const showPaywall = chip.kind === 'pro'
  const showStatus = Boolean(assignment) && view === 'status'

  const tooltip =
    chip.kind === 'pro'
      ? t(($) => $['studio.accessControl.tooltipPro'], { ns: 'deployments' })
      : chip.kind === 'paused'
        ? t(($) => $['studio.accessControl.tooltipPaused'], {
            ns: 'deployments',
            name: chip.policyName ?? '',
          })
        : chip.kind === 'on'
          ? t(($) => $['studio.accessControl.tooltipOn'], {
              ns: 'deployments',
              name: chip.policyName ?? '',
            })
          : chip.kind === 'partial'
            ? t(($) => $['studio.accessControl.tooltipPartial'], {
                ns: 'deployments',
                name: chip.policyName ?? '',
                n: chip.coveredCount,
                m: chip.inServiceCount,
              })
            : t(($) => $['studio.accessControl.tooltipOff'], { ns: 'deployments' })

  const handleTurnOn = () => {
    setShowPricingModal()
    const gtag = (window as Window & { gtag?: GtagHandler }).gtag
    if (gtag) gtag('event', 'click_upgrade_btn', { loc: 'access-control-paywall' })
  }

  const handleCancel = () => {
    setDraft(null)
    if (assignment) {
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
    setSavedDraft(resolvedDraft)
    setEnabled(true)
    setDraft(null)
    setView('status')
    setShowBack(false)
  }

  return (
    <Tooltip>
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          render={
            <PopoverTrigger className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border-[0.5px] border-divider-deep px-2.5 shadow-xs outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid" />
          }
        >
          <span aria-hidden className="i-ri-shield-keyhole-line size-4 text-text-secondary" />
          <span className="system-sm-medium text-text-secondary">{label}</span>
          <AccessControlChipAffix
            kind={chip.kind}
            coveredCount={chip.coveredCount}
            inServiceCount={chip.inServiceCount}
          />
        </TooltipTrigger>
        <PopoverContent
          placement="bottom-end"
          className="w-100 rounded-2xl border-divider-regular p-0 backdrop-blur-[5px] transition-none data-starting-style:scale-100 data-starting-style:opacity-100"
        >
          {showPaywall ? (
            <AccessControlFreePaywall onTurnOn={handleTurnOn} />
          ) : showStatus && savedDraft ? (
            <AccessControlStatusPanel
              draft={savedDraft}
              policies={policies}
              enabled={enabled}
              availability={availability}
              onEnabledChange={setEnabled}
              onEdit={() => {
                setDraft(savedDraft)
                setShowBack(true)
                setView('config')
              }}
            />
          ) : (
            <AccessControlConfigPanel
              draft={resolvedDraft}
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
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
