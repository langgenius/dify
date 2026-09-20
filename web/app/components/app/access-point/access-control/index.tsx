'use client'

import type { ComponentProps } from 'react'
import type { AccessControlAssignment } from './chip-status'
import type { AccessControlDraft } from './draft'
import type AppIcon from '@/app/components/base/app-icon'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import { IpPolicyDialog } from '@/app/components/header/account-setting/ip-policies-page/policy-dialog'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import {
  canManageNetworkAccessPoliciesAtom,
  canReadNetworkAccessAtom,
} from '@/features/network-access/permissions'
import { consoleQuery } from '@/service/console'
import { AccessControlChipAffix } from './chip-affix'
import { getAccessControlChipState } from './chip-status'
import { AccessControlConfigPanel } from './config-panel'
import { AccessControlDowngradePanel } from './downgrade-panel'
import { canSaveAccessControl, isAccessControlDraftEqual } from './draft'
import { AccessControlFreePaywall } from './free-paywall'
import {
  accessPointsFromScopes,
  draftFromBinding,
  getAvailableAccessPoints,
  getNetworkAccessErrorStatus,
} from './network-access'
import { AccessControlStatusPanel } from './status-panel'

export type AccessControlAppIcon = Pick<
  ComponentProps<typeof AppIcon>,
  'iconType' | 'icon' | 'background' | 'imageUrl'
>

type AccessControlEntryProps = {
  appId: string
  appIcon: AccessControlAppIcon
  canEditBinding: boolean
  isPublished: boolean
}

type GtagHandler = (command: 'event', action: 'click_upgrade_btn', payload: { loc: string }) => void

export function AccessControlEntry(props: AccessControlEntryProps) {
  return <AccessControlSession key={`${props.appId}:${props.canEditBinding}`} {...props} />
}

function AccessControlSession({
  appId,
  appIcon,
  canEditBinding,
  isPublished,
}: AccessControlEntryProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const canRead = useAtomValue(canReadNetworkAccessAtom)
  const canManagePolicies = useAtomValue(canManageNetworkAccessPoliciesAtom)
  const [_pricing, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)
  const [_settingsDestination, setSettingsDestination] = useQueryState(
    settingsQueryParamName,
    settingsQueryParser,
  )
  const canFetchNetworkAccess = canRead && Boolean(appId)
  const groupsQuery = useQuery(
    consoleQuery.workspaces.current.networkAccessGroups.get.queryOptions({
      enabled: canFetchNetworkAccess,
      retry: false,
    }),
  )
  const bindingQuery = useQuery(
    consoleQuery.apps.byAppId.networkAccessGroup.get.queryOptions({
      input: { params: { app_id: appId } },
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
  const [confirmation, setConfirmation] = useState<{
    draft: AccessControlDraft
    clientIp: string
    policyVersion: number
    changed: boolean
  } | null>(null)
  const saveAttemptRef = useRef(0)
  const selectedPolicyId = draft ? draft.selectedPolicyId : bindingQuery.data?.binding?.group_id
  const checkCurrentIp =
    consoleQuery.workspaces.current.networkAccessGroups.byGroupId.checkCurrentIp.get
  const ipCheck = useQuery(
    checkCurrentIp.queryOptions({
      input: selectedPolicyId ? { params: { group_id: selectedPolicyId } } : skipToken,
      enabled:
        canFetchNetworkAccess &&
        canEditBinding &&
        bindingQuery.data?.entitled === true &&
        open &&
        view === 'config',
      context: { silent: true },
      staleTime: 0,
      retry: false,
    }),
  )
  const saveCheck = useMutation(checkCurrentIp.mutationOptions({ context: { silent: true } }))

  const bindingErrorStatus = getNetworkAccessErrorStatus(bindingQuery.error)
  const hideForUnsupportedApp =
    canFetchNetworkAccess &&
    Boolean(appId) &&
    (bindingErrorStatus === 400 || bindingErrorStatus === 403 || bindingErrorStatus === 404)

  if (!canFetchNetworkAccess) return null
  if (hideForUnsupportedApp) return null
  if (groupsQuery.isPending || bindingQuery.isPending) return null
  if (groupsQuery.isError || bindingQuery.isError || !groupsQuery.data || !bindingQuery.data)
    return null
  if (!Array.isArray(bindingQuery.data.available_access_points)) return null
  const availableAccessPoints = getAvailableAccessPoints(bindingQuery.data.available_access_points)
  if (!availableAccessPoints.length) return null

  const label = t(($) => $['studio.accessControl.entryLabel'], { ns: 'deployments' })
  const groups = groupsQuery.data.groups
  const binding = bindingQuery.data.binding
  const policies = groups.map((group) => ({
    id: group.id,
    name: group.name,
    allowed_cidrs: group.allowed_cidrs,
  }))
  const baseline = draftFromBinding(binding, availableAccessPoints)
  const entitled = bindingQuery.data.entitled
  const canMutate = canRead && canEditBinding && entitled
  const resolvedDraft = canMutate ? (draft ?? baseline) : baseline
  const assignment: AccessControlAssignment | null = binding?.group_id
    ? {
        policyId: binding.group_id,
        policyName: groups.find((group) => group.id === binding.group_id)?.name ?? binding.group_id,
        scopes: baseline.scopes,
        enabled: binding.enabled,
      }
    : null
  const dirty = !isAccessControlDraftEqual(resolvedDraft, baseline, availableAccessPoints)
  const canSave = canSaveAccessControl({
    draft: resolvedDraft,
    baseline,
    availableAccessPoints,
  })
  const chip = getAccessControlChipState({ entitled, assignment, availableAccessPoints })
  const showPaywall = chip.kind === 'pro'
  const showDowngrade = Boolean(assignment) && !entitled
  const showStatus = Boolean(assignment) && entitled && (!canMutate || view === 'status')

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
            })
          : chip.kind === 'partial'
            ? t(($) => $['studio.accessControl.tooltipPartial'], {
                ns: 'deployments',
                n: chip.coveredCount,
                total: chip.inServiceCount,
              })
            : t(($) => $['studio.accessControl.tooltipOff'], { ns: 'deployments' })

  const handleTurnOn = () => {
    void setPricing('open')
    const gtag = (window as Window & { gtag?: GtagHandler }).gtag
    if (gtag) gtag('event', 'click_upgrade_btn', { loc: 'access-control-paywall' })
  }

  const discardDraft = () => {
    saveAttemptRef.current += 1
    saveCheck.reset()
    setConfirmation(null)
    setDraft(null)
    setShowBack(false)
  }

  const handleCancel = () => {
    discardDraft()
    if (assignment) {
      setView('status')
      return
    }
    setOpen(false)
  }

  const handleBack = () => {
    discardDraft()
    setView('status')
  }

  const handleCreatePolicy = () => {
    if (!canMutate || !canManagePolicies) return
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
    if (!canMutate) return

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

  const saveDraft = (nextDraft: AccessControlDraft) => {
    persistBinding(
      {
        enabled: nextDraft.enabled,
        groupId: nextDraft.selectedPolicyId,
        accessPoints: accessPointsFromScopes(nextDraft.scopes, availableAccessPoints),
      },
      () => {
        discardDraft()
        setView('status')
        setOpen(true)
      },
    )
  }

  const handleSave = (acceptedVersion?: number) => {
    const nextDraft = confirmation?.draft ?? resolvedDraft
    if (
      !canMutate ||
      !canSave ||
      !nextDraft.selectedPolicyId ||
      saveCheck.isPending ||
      updateBinding.isPending
    )
      return
    if (!nextDraft.enabled) {
      saveDraft(nextDraft)
      return
    }
    const groupId = nextDraft.selectedPolicyId
    const attempt = ++saveAttemptRef.current
    saveCheck.mutate(
      { params: { group_id: groupId } },
      {
        onSuccess: (check) => {
          if (saveAttemptRef.current !== attempt) return
          queryClient.setQueryData(
            checkCurrentIp.queryKey({ input: { params: { group_id: groupId } } }),
            check,
          )
          if (isPublished && !check.allowed && acceptedVersion !== check.policy_version) {
            setConfirmation({
              draft: nextDraft,
              clientIp: check.client_ip,
              policyVersion: check.policy_version,
              changed: acceptedVersion !== undefined,
            })
            setOpen(false)
            return
          }
          setConfirmation(null)
          saveDraft(nextDraft)
        },
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
              saveAttemptRef.current += 1
              saveCheck.reset()
              if (!dirty) discardDraft()
              return
            }
            if (dirty) {
              setView('config')
              setShowBack(Boolean(assignment) && canMutate)
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
            ) : showDowngrade && assignment ? (
              <AccessControlDowngradePanel
                assignment={assignment}
                appIcon={appIcon}
                availableAccessPoints={availableAccessPoints}
                onTurnOn={handleTurnOn}
              />
            ) : showStatus && assignment ? (
              <AccessControlStatusPanel
                draft={resolvedDraft}
                appIcon={appIcon}
                availableAccessPoints={availableAccessPoints}
                policies={policies}
                enabled={resolvedDraft.enabled}
                updating={updateBinding.isPending}
                dirty={dirty}
                canSave={canSave}
                readOnly={!canMutate}
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
                appIcon={appIcon}
                availableAccessPoints={availableAccessPoints}
                policies={policies}
                readOnly={!canMutate}
                ipCheck={ipCheck.isSuccess && !ipCheck.isFetching ? ipCheck.data : undefined}
                ipCheckStatus={
                  saveCheck.isPending || ipCheck.isFetching
                    ? 'loading'
                    : saveCheck.isError || ipCheck.isError
                      ? 'error'
                      : undefined
                }
                onRetryIpCheck={() => {
                  saveCheck.reset()
                  void ipCheck.refetch()
                }}
                canManagePolicies={canManagePolicies}
                baseline={baseline}
                showBack={showBack}
                saving={updateBinding.isPending || saveCheck.isPending}
                onBack={handleBack}
                onCancel={handleCancel}
                onCreatePolicy={handleCreatePolicy}
                onManagePolicies={handleManagePolicies}
                onDraftChange={(nextDraft) => {
                  if (canMutate) {
                    saveAttemptRef.current += 1
                    saveCheck.reset()
                    setDraft(nextDraft)
                  }
                }}
                onSave={() => handleSave()}
              />
            )}
          </PopoverContent>
        </Popover>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      {createPolicyOpen && canMutate && canManagePolicies && (
        <IpPolicyDialog
          mode="create"
          open
          isPending={createGroup.isPending}
          onOpenChange={handlePolicyDialogOpenChange}
          onSubmit={(payload) => {
            if (!canMutate || !canManagePolicies) return
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
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(nextOpen) => {
          if (nextOpen) return
          saveAttemptRef.current += 1
          saveCheck.reset()
          setConfirmation(null)
          setOpen(true)
        }}
      >
        <AlertDialogContent className="w-100">
          <AlertDialogTitle>
            {t(($) => $['studio.accessControl.saveWithoutOwnIp'], { ns: 'deployments' })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(($) => $['studio.accessControl.lockoutWarning'], {
              ns: 'deployments',
              ip: confirmation?.clientIp,
            })}
          </AlertDialogDescription>
          {confirmation?.changed && (
            <p role="status" className="system-sm-regular text-text-warning">
              {t(($) => $['studio.accessControl.policyChanged'], { ns: 'deployments' })}
            </p>
          )}
          {saveCheck.isError && (
            <p role="alert" className="system-sm-regular text-text-warning">
              {t(($) => $['settings.ipPolicyCurrentIpError'], { ns: 'common' })}
            </p>
          )}
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={saveCheck.isPending || updateBinding.isPending}
              disabled={!canMutate}
              onClick={() => handleSave(confirmation?.policyVersion)}
            >
              {t(($) => $['studio.accessControl.saveAnyway'], { ns: 'deployments' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
