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
import { IpPolicyDialog } from '@/app/components/header/account-setting/ip-policies-page/policy-dialog'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { AccessControlChipAffix } from './chip-affix'
import { getAccessControlChipState } from './chip-status'
import { AccessControlConfigPanel } from './config-panel'
import { canSaveAccessControl, isAccessControlDraftEqual } from './draft'
import { AccessControlFreePaywall } from './free-paywall'
import {
  accessPointsFromScopes,
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
  const createGroup = useMutation(
    consoleQuery.workspaces.current.networkAccessGroups.post.mutationOptions(),
  )
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'config' | 'status'>('status')
  const [showBack, setShowBack] = useState(false)
  const [draft, setDraft] = useState<AccessControlDraft | null>(null)
  const [createPolicyOpen, setCreatePolicyOpen] = useState(false)

  const bindingErrorStatus = getNetworkAccessErrorStatus(bindingQuery.error)
  const hideForUnsupportedApp =
    canFetchNetworkAccess &&
    Boolean(appId) &&
    (bindingErrorStatus === 400 || bindingErrorStatus === 403 || bindingErrorStatus === 404)

  if (deploymentEdition !== 'CLOUD' || !isManager) return null
  if (hideForUnsupportedApp) return null
  if (groupsQuery.isPending || (appId && bindingQuery.isPending)) return null

  const label = t(($) => $['studio.accessControl.entryLabel'], { ns: 'deployments' })
  const groups = groupsQuery.data?.groups ?? []
  const binding = bindingQuery.data?.binding
  const policies = groups.map((group) => ({
    id: group.id,
    name: group.name,
    allowed_cidrs: group.allowed_cidrs,
  }))
  const baseline = draftFromBinding(binding)
  const resolvedDraft = draft ?? baseline
  const assignment: AccessControlAssignment | null = binding?.group_id
    ? {
        policyId: binding.group_id,
        policyName: groups.find((group) => group.id === binding.group_id)?.name ?? binding.group_id,
        scopes: scopesFromAccessPoints(binding.access_points),
        enabled: binding.enabled,
      }
    : null
  const entitled = bindingQuery.data?.entitled ?? groupsQuery.data?.entitled
  const canMutate = entitled === true
  const dirty = !isAccessControlDraftEqual(resolvedDraft, baseline)
  const persistableAccessPoints = accessPointsFromScopes(
    resolvedDraft.scopes,
    bindingQuery.data?.available_access_points,
  )
  const canSave = canSaveAccessControl({
    draft: resolvedDraft,
    baseline,
    persistableAccessPoints,
  })
  const chip = getAccessControlChipState({ entitled, assignment })
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
    setCreatePolicyOpen(true)
  }

  const handleManagePolicies = () => {
    setOpen(false)
    void setSettingsDestination('ip-policies')
  }

  const handlePolicyDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen) return
    setCreatePolicyOpen(false)
    setOpen(true)
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
        accessPoints: persistableAccessPoints,
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
    <>
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
                persistableAccessPoints={persistableAccessPoints}
                baseline={baseline}
                showBack={showBack}
                saving={updateBinding.isPending}
                onBack={handleBack}
                onCancel={handleCancel}
                onCreatePolicy={handleCreatePolicy}
                onManagePolicies={handleManagePolicies}
                onDraftChange={setDraft}
                onSave={handleSave}
              />
            )}
          </PopoverContent>
        </Popover>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      {createPolicyOpen && (
        <IpPolicyDialog
          mode="create"
          open
          isPending={createGroup.isPending}
          onOpenChange={handlePolicyDialogOpenChange}
          onSubmit={(payload) => {
            createGroup.mutate(
              {
                body: {
                  name: payload.name,
                  description: '',
                  allowed_cidrs: payload.allowed_cidrs,
                },
              },
              {
                onSuccess: (data) => {
                  queryClient.setQueryData(
                    consoleQuery.workspaces.current.networkAccessGroups.get.queryOptions().queryKey,
                    (current) => {
                      if (!current) return current
                      if (current.groups.some((group) => group.id === data.group.id)) return current
                      return {
                        ...current,
                        groups: [...current.groups, data.group],
                      }
                    },
                  )
                  setDraft({
                    ...resolvedDraft,
                    selectedPolicyId: data.group.id,
                  })
                  setCreatePolicyOpen(false)
                  setView('config')
                  setOpen(true)
                },
              },
            )
          }}
        />
      )}
    </>
  )
}
