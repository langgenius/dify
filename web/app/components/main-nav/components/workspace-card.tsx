'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import LicenseNav from '@/app/components/header/license-env'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import { IS_CLOUD_EDITION } from '@/config'
import { useModalContext } from '@/context/modal-context'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useProviderContext } from '@/context/provider-context'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { hasPermission } from '@/utils/permission'
import { basePath } from '@/utils/var'
import { formatCredits, getRemainingCredits } from '../utils'
import { WorkspaceIcon, WorkspaceMenuItemContent } from './workspace-menu-content'
import WorkspacePlanBadge from './workspace-plan-badge'
import { WorkspaceSwitcher } from './workspace-switcher'

const workspaceMenuTriggerHeight = 36
const workspaceMenuAlignOffset = -28
const workspaceCardSkeletonClassName = 'animate-pulse rounded bg-text-quaternary opacity-20 motion-reduce:animate-none'
const workspacePlans = new Set<string>(Object.values(Plan))

function isWorkspacePlan(plan: string | null | undefined): plan is Plan {
  return !!plan && workspacePlans.has(plan)
}

function WorkspaceCardSkeleton({
  showCloudBilling,
  showPlanAction,
}: {
  showCloudBilling: boolean
  showPlanAction: boolean
}) {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border border-components-card-border bg-components-card-bg shadow-xs"
    >
      <div className="flex w-full items-center gap-1.5 py-1.5 pr-3 pl-1.5">
        <div className={cn(workspaceCardSkeletonClassName, 'h-6 w-6 shrink-0 rounded-lg')} />
        <div className="flex min-w-0 grow items-center">
          <div className={cn(workspaceCardSkeletonClassName, 'h-4 w-32 max-w-full')} />
        </div>
        <div className={cn(workspaceCardSkeletonClassName, 'h-4 w-4 shrink-0')} />
      </div>
      {showCloudBilling && (
        <div className="flex items-center justify-center gap-1.5 border-t border-divider-subtle py-2 pr-2.5 pl-2">
          <div className="flex min-w-0 flex-1 items-center px-1">
            <div className={cn(workspaceCardSkeletonClassName, 'h-4 w-24 max-w-full')} />
          </div>
          {showPlanAction && (
            <div className={cn(workspaceCardSkeletonClassName, 'h-4 w-16 shrink-0')} />
          )}
        </div>
      )}
    </div>
  )
}

function WorkspaceCreditsLabel({
  credits,
  unit,
}: {
  credits: string
  unit: string
}) {
  const label = `${credits} ${unit}`

  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-0.5" title={label}>
      <span className="shrink-0 system-xs-medium">{credits}</span>
      <span className="min-w-0 truncate system-xs-regular">{unit}</span>
    </span>
  )
}

function WorkspaceCardTrigger({
  open,
  name,
  status,
  credits,
  showCloudBilling,
  showPlanAction,
  planActionLabel,
  creditsHref,
  onPlanClick,
}: {
  open: boolean
  name: string
  status: ReactNode
  credits: string
  showCloudBilling: boolean
  showPlanAction: boolean
  planActionLabel: string
  creditsHref: string
  onPlanClick: () => void
}) {
  const { t } = useTranslation()
  const creditsUnit = t($ => $['mainNav.workspace.creditsUnit'], { ns: 'common' })
  const showStatus = status !== undefined && status !== null

  return (
    <div className="overflow-hidden rounded-xl border border-components-card-border bg-components-card-bg text-left shadow-xs transition-colors hover:bg-components-card-bg-alt">
      <PopoverTrigger
        aria-label={t($ => $['mainNav.workspace.openMenu'], { ns: 'common' })}
        title={name}
        className={cn(
          'flex w-full items-center gap-1.5 py-1.5 pr-3 pl-1.5 text-left transition-colors focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden',
          showCloudBilling ? 'rounded-t-xl' : 'rounded-xl',
          open && 'bg-linear-to-b from-background-section-burn to-background-section',
        )}
      >
        <WorkspaceIcon name={name} className="h-6 w-6 rounded-lg" />
        <div className="min-w-0 grow">
          <div className="flex min-w-0 items-center gap-1 pr-0.5">
            <span className="max-w-[120px] min-w-0 shrink truncate system-sm-medium text-text-primary" title={name}>{name}</span>
            {showStatus && <span className="flex shrink-0 items-center">{status}</span>}
          </div>
        </div>
        <span aria-hidden className="i-ri-expand-up-down-line h-4 w-4 shrink-0 text-text-tertiary" />
      </PopoverTrigger>
      {showCloudBilling && (
        <div className="flex items-center justify-center gap-1.5 border-t border-divider-subtle py-2 pr-2.5 pl-2">
          <Link
            href={creditsHref}
            className="flex min-w-0 flex-1 items-center gap-0.5 px-1 text-left text-text-tertiary transition-colors hover:text-text-secondary focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden"
            aria-label={t($ => $['mainNav.workspace.credits'], { ns: 'common', count: credits })}
          >
            <span className="i-custom-vender-main-nav-credits h-3 w-3 shrink-0" aria-hidden />
            <WorkspaceCreditsLabel credits={credits} unit={creditsUnit} />
          </Link>
          {showPlanAction && (
            <button
              type="button"
              title={planActionLabel}
              className="max-w-30 shrink-0 truncate px-1 system-xs-semibold-uppercase text-saas-dify-blue-accessible transition-colors hover:text-saas-dify-blue-static-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden"
              onClick={onPlanClick}
            >
              {planActionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function WorkspaceMenuHeader({
  name,
  status,
  showInviteMembers,
  settingsLabel,
  inviteMembersLabel,
  onOpenSettings,
  onInviteMembers,
}: {
  name: string
  status: ReactNode
  showInviteMembers: boolean
  settingsLabel: ReactNode
  inviteMembersLabel: ReactNode
  onOpenSettings: () => void
  onInviteMembers: () => void
}) {
  return (
    <div className="p-1">
      <div className="rounded-xl border-[0.5px] border-components-panel-border bg-linear-to-b from-background-section-burn to-background-section pb-2">
        <div className="flex h-16 items-center gap-2 px-3">
          <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
            <PopoverTitle className="w-full min-w-0 truncate text-base/5 font-medium text-text-primary" title={name}>{name}</PopoverTitle>
            {status}
          </div>
          <WorkspaceIcon name={name} className="h-9 w-9 shrink-0" />
        </div>
        <button
          type="button"
          className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1 text-left outline-hidden hover:bg-state-base-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
          onClick={onOpenSettings}
        >
          <WorkspaceMenuItemContent icon={<span aria-hidden className="i-custom-vender-main-nav-workspace-settings h-4 w-4" />} label={settingsLabel} />
        </button>
        {showInviteMembers && (
          <button
            type="button"
            className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1 text-left outline-hidden hover:bg-state-base-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
            onClick={onInviteMembers}
          >
            <WorkspaceMenuItemContent icon={<span aria-hidden className="i-ri-user-add-line h-4 w-4" />} label={inviteMembersLabel} />
          </button>
        )}
      </div>
    </div>
  )
}

const selectCurrentWorkspaceCardData = (workspace: {
  id: string
  name?: string | null
  role?: string | null
  trial_credits?: number | null
  trial_credits_used?: number | null
}) => ({
  id: workspace.id,
  name: workspace.name,
  role: workspace.role,
  credits: getRemainingCredits(workspace.trial_credits ?? 0, workspace.trial_credits_used ?? 0),
})

export function WorkspaceCard() {
  const { t } = useTranslation()
  const currentWorkspaceQuery = useQuery(consoleQuery.workspaces.current.post.queryOptions({
    select: selectCurrentWorkspaceCardData,
  }))
  const workspacesQuery = useQuery(consoleQuery.workspaces.get.queryOptions())
  const switchWorkspaceMutation = useMutation(consoleQuery.workspaces.switch.post.mutationOptions())
  const currentWorkspace = currentWorkspaceQuery.data
  const workspacesData = workspacesQuery.data
  const workspaces = workspacesData?.workspaces
  const currentWorkspaceInList = workspaces?.find(workspace => workspace.current)
  const { enableBilling } = useProviderContext()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext()
  const showCloudBilling = IS_CLOUD_EDITION && enableBilling
  const [open, setOpen] = useState(false)

  if (currentWorkspaceQuery.isPending || workspacesQuery.isPending || !currentWorkspace?.name || !currentWorkspace.role || !workspaces || !currentWorkspaceInList || !isWorkspacePlan(currentWorkspaceInList.plan)) {
    return (
      <WorkspaceCardSkeleton
        showCloudBilling={showCloudBilling}
        showPlanAction={showCloudBilling}
      />
    )
  }

  const formattedCredits = formatCredits(currentWorkspace.credits)
  const workspacePlan = currentWorkspaceInList.plan
  const isFreePlan = workspacePlan === Plan.sandbox
  const showPlanAction = showCloudBilling
  const planActionLabel = t($ => $[isFreePlan ? 'upgradeBtn.encourageShort' : 'upgradeBtn.plain'], { ns: 'billing' })
  const showInviteMembers = hasPermission(workspacePermissionKeys, 'workspace.member.manage')
  const renderWorkspaceStatus = () => enableBilling ? <WorkspacePlanBadge plan={workspacePlan} /> : <LicenseNav />

  const handleSwitchWorkspace = async (tenant_id: string) => {
    try {
      if (currentWorkspace.id === tenant_id)
        return

      await switchWorkspaceMutation.mutateAsync({ body: { tenant_id } })
      toast.success(t($ => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      location.assign(`${location.origin}${basePath}`)
    }
    catch {
      toast.error(t($ => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <>
        <WorkspaceCardTrigger
          open={open}
          name={currentWorkspace.name}
          status={renderWorkspaceStatus()}
          credits={formattedCredits}
          showCloudBilling={showCloudBilling}
          showPlanAction={showPlanAction}
          planActionLabel={planActionLabel}
          creditsHref={buildIntegrationPath('provider')}
          onPlanClick={setShowPricingModal}
        />
        <PopoverContent
          placement="bottom-start"
          sideOffset={-workspaceMenuTriggerHeight}
          alignOffset={workspaceMenuAlignOffset}
          popupClassName="w-[280px] overflow-hidden bg-components-panel-bg-blur! p-0! backdrop-blur-[5px]"
        >
          <WorkspaceMenuHeader
            name={currentWorkspace.name}
            status={renderWorkspaceStatus()}
            showInviteMembers={showInviteMembers}
            settingsLabel={t($ => $['mainNav.workspace.settings'], { ns: 'common' })}
            inviteMembersLabel={t($ => $['mainNav.workspace.inviteMembers'], { ns: 'common' })}
            onOpenSettings={() => {
              setOpen(false)
              setShowAccountSettingModal({
                payload: enableBilling
                  ? ACCOUNT_SETTING_TAB.BILLING
                  : ACCOUNT_SETTING_TAB.MEMBERS,
              })
            }}
            onInviteMembers={() => {
              setOpen(false)
              setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.MEMBERS })
            }}
          />
          {workspaces.length > 0 && (
            <div className="p-1 pb-2">
              <WorkspaceSwitcher
                workspaces={workspaces}
                onSwitchWorkspace={(workspaceId) => {
                  setOpen(false)
                  void handleSwitchWorkspace(workspaceId)
                }}
              />
            </div>
          )}
        </PopoverContent>
      </>
    </Popover>
  )
}
