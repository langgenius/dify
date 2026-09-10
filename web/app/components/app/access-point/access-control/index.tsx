'use client'

import type { AccessControlAssignment } from './chip-status'
import type { AccessControlDraft } from './draft'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { useAppWorkflow } from '@/service/use-workflow'
import { getPublishedWorkflowState, isAdvancedApp } from '../shared/utils'
import { AccessControlChipAffix } from './chip-affix'
import { getAccessControlChipState } from './chip-status'
import { AccessControlConfigPanel } from './config-panel'
import {
  canSaveAccessControl,
  getAccessControlScopeAvailability,
  isAccessControlDraftEqual,
} from './draft'
import { AccessControlFreePaywall } from './free-paywall'
import {
  accessPointsFromScopes,
  availabilityFromAccessPoints,
  draftFromBinding,
  getNetworkAccessErrorStatus,
  scopesFromAccessPoints,
} from './network-access'
import { AccessControlStatusPanel } from './status-panel'

type GtagHandler = (command: 'event', action: 'click_upgrade_btn', payload: { loc: string }) => void

export function AccessControlEntry() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const isManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const [_pricing, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)
  const [_settingsDestination, setSettingsDestination] = useQueryState(
    settingsQueryParamName,
    settingsQueryParser,
  )
  const appInfo = useAppStore((state) => state.appDetail)
  const appId = appInfo?.id
  const canFetchNetworkAccess = deploymentEdition === 'CLOUD' && isManager
  const shouldFetchWorkflow = Boolean(appInfo && isAdvancedApp(appInfo))
  const { data: workflow } = useAppWorkflow(
    shouldFetchWorkflow && canFetchNetworkAccess && appInfo ? appInfo.id : '',
  )
  const groupsQuery = useQuery(
    consoleQuery.workspaces.current.networkAccessGroups.get.queryOptions({
      enabled: canFetchNetworkAccess,
      retry: false,
    }),
  )
  const bindingQuery = useQuery(
    consoleQuery.apps.byAppId.networkAccessGroup.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
      context: { silent: true },
      retry: false,
      enabled: canFetchNetworkAccess && Boolean(appId),
    }),
  )
  const updateBinding = useMutation(
    consoleQuery.apps.byAppId.networkAccessGroup.put.mutationOptions(),
  )
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'config' | 'status'>('status')
  const [showBack, setShowBack] = useState(false)
  const [draft, setDraft] = useState<AccessControlDraft | null>(null)

  const bindingErrorStatus = getNetworkAccessErrorStatus(bindingQuery.error)
  const hideForUnsupportedApp =
    canFetchNetworkAccess &&
    Boolean(appId) &&
    (bindingErrorStatus === 400 || bindingErrorStatus === 403 || bindingErrorStatus === 404)

  if (deploymentEdition !== 'CLOUD' || !isManager) return null
  if (hideForUnsupportedApp) return null
  if (groupsQuery.isPending || (appId && bindingQuery.isPending)) return null

  const label = t(($) => $['studio.accessControl.entryLabel'], { ns: 'deployments' })
  const workflowState = appInfo ? getPublishedWorkflowState(appInfo, workflow) : undefined
  const triggerAvailable = getAccessControlScopeAvailability({
    mode: appInfo?.mode,
    hasTriggerNode: Boolean(workflowState?.hasTriggerNode),
    isUnpublished: Boolean(workflowState?.isUnpublished),
  }).trigger
  const availability = availabilityFromAccessPoints(
    bindingQuery.data?.available_access_points ?? [],
    triggerAvailable,
  )
  const groups = groupsQuery.data?.groups ?? []
  const binding = bindingQuery.data?.binding
  const policies = groups.map((group) => ({
    id: group.id,
    name: group.name,
    allowed_cidrs: group.allowed_cidrs,
  }))
  const baseline = draftFromBinding(binding, availability)
  const resolvedDraft = draft ?? baseline
  const assignment: AccessControlAssignment | null = binding?.group_id
    ? {
        policyId: binding.group_id,
        policyName: groups.find((group) => group.id === binding.group_id)?.name ?? binding.group_id,
        scopes: scopesFromAccessPoints(binding.access_points, availability),
        enabled: binding.enabled,
      }
    : null
  const entitled = bindingQuery.data?.entitled ?? groupsQuery.data?.entitled
  const canMutate = entitled === true
  const dirty = !isAccessControlDraftEqual(resolvedDraft, baseline)
  const canSave = canSaveAccessControl({
    draft: resolvedDraft,
    availability,
    baseline,
  })
  const chip = getAccessControlChipState({ entitled, assignment, availability })
  const showPaywall = chip.kind === 'pro'
  const showStatus = Boolean(assignment) && (view === 'status' || !canMutate)

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
    void setPricing('open')
    const gtag = (window as Window & { gtag?: GtagHandler }).gtag
    if (gtag) gtag('event', 'click_upgrade_btn', { loc: 'access-control-paywall' })
  }

  const handleCancel = () => {
    setDraft(null)
    setShowBack(false)
    if (assignment) {
      setView('status')
      return
    }
    setOpen(false)
  }

  const handleBack = () => {
    setShowBack(false)
    setView('status')
  }

  const handleCreatePolicy = () => {
    setOpen(false)
    void setSettingsDestination('ip-policies')
  }

  const persistBinding = (
    {
      enabled,
      groupId,
      accessPoints,
    }: {
      enabled: boolean
      groupId: string | null
      accessPoints: ReturnType<typeof accessPointsFromScopes>
    },
    onSuccess?: () => void,
  ) => {
    if (!appId) return

    updateBinding.mutate(
      {
        params: { app_id: appId },
        body: {
          enabled,
          group_id: groupId,
          access_points: accessPoints,
          expected_version: binding?.version ?? 0,
        },
      },
      {
        onSuccess,
        onError: (error) => {
          if (getNetworkAccessErrorStatus(error) !== 409) return
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.apps.byAppId.networkAccessGroup.get.queryKey({
              input: { params: { app_id: appId } },
            }),
          })
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.networkAccessGroups.get.queryKey(),
          })
        },
      },
    )
  }

  const handleSave = () => {
    if (!canMutate || !canSave || !resolvedDraft.selectedPolicyId) return

    persistBinding(
      {
        enabled: resolvedDraft.enabled,
        groupId: resolvedDraft.selectedPolicyId,
        accessPoints: accessPointsFromScopes(resolvedDraft.scopes, availability),
      },
      () => {
        setDraft(null)
        setView('status')
        setShowBack(false)
      },
    )
  }

  const handleEnabledChange = (enabled: boolean) => {
    if (!canMutate) return
    setDraft({ ...resolvedDraft, enabled })
  }

  return (
    <Tooltip>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) {
            setDraft(null)
            setShowBack(false)
            return
          }
          setView(assignment || !canMutate ? 'status' : 'config')
          setShowBack(false)
        }}
      >
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
          ) : showStatus && assignment ? (
            <AccessControlStatusPanel
              draft={resolvedDraft}
              policies={policies}
              enabled={resolvedDraft.enabled}
              availability={availability}
              updating={updateBinding.isPending}
              dirty={dirty}
              canSave={canSave}
              readOnly={!canMutate}
              onUpgrade={handleTurnOn}
              onEnabledChange={handleEnabledChange}
              onCancel={handleCancel}
              onSave={handleSave}
              onEdit={() => {
                if (!canMutate) return
                setDraft(resolvedDraft)
                setShowBack(true)
                setView('config')
              }}
            />
          ) : (
            <AccessControlConfigPanel
              draft={resolvedDraft}
              policies={policies}
              availability={availability}
              baseline={baseline}
              showBack={showBack}
              saving={updateBinding.isPending}
              onBack={handleBack}
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
