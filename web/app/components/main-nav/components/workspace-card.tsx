'use client'

import type { GetWorkspacesCurrentSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkspaceAvatar } from '@/app/components/base/workspace-avatar'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import LicenseBadge from '@/app/components/header/license-badge'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import { useModalContext } from '@/context/modal-context'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { hasPermission } from '@/utils/permission'
import { basePath } from '@/utils/var'
import { formatCredits } from '../utils'
import { WorkspaceMenuItemContent } from './workspace-menu-content'
import WorkspacePlanBadge from './workspace-plan-badge'
import { WorkspaceSwitcher } from './workspace-switcher'

const workspaceMenuTriggerHeight = 36
const workspaceMenuAlignOffset = -28
const workspaceCardSkeletonClassName =
  'animate-pulse rounded bg-text-quaternary opacity-20 motion-reduce:animate-none'
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

function WorkspaceCreditsLabel({ credits, unit }: { credits: string; unit?: string }) {
  const label = [credits, unit].filter(Boolean).join(' ')

  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-0.5" title={label}>
      <span className="shrink-0 system-xs-medium">{credits}</span>
      {unit && <span className="min-w-0 truncate system-xs-regular">{unit}</span>}
    </span>
  )
}

function WorkspaceCardTrigger({
  name,
  status,
  credits,
  showCloudBilling,
  showPlanAction,
  planActionLabel,
  creditsHref,
  onPrefetchWorkspaces,
  onPlanClick,
}: {
  name: string
  status: ReactNode
  credits: number | null
  showCloudBilling: boolean
  showPlanAction: boolean
  planActionLabel: string
  creditsHref: string
  onPrefetchWorkspaces: () => void
  onPlanClick: () => void
}) {
  const { t } = useTranslation()
  const creditsUnit = t(($) => $['mainNav.workspace.creditsUnit'], { ns: 'common' })
  const isUnlimited = credits === -1
  const formattedCredits = isUnlimited
    ? t(($) => $['license.unlimited'], { ns: 'common' })
    : credits === null
      ? ''
      : formatCredits(credits)
  const showStatus = status !== undefined && status !== null

  return (
    <div className="overflow-hidden rounded-xl border border-components-card-border bg-components-card-bg text-left shadow-xs">
      <PopoverTrigger
        aria-label={t(($) => $['mainNav.workspace.openMenu'], { ns: 'common' })}
        title={name}
        onMouseEnter={onPrefetchWorkspaces}
        onFocus={onPrefetchWorkspaces}
        className={cn(
          'flex w-full items-center gap-1.5 py-1.5 pr-3 pl-1.5 text-left transition-colors hover:bg-state-base-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden',
          showCloudBilling ? 'rounded-t-xl' : 'rounded-xl',
          'data-popup-open:bg-linear-to-b data-popup-open:from-background-section-burn data-popup-open:to-background-section',
        )}
      >
        <WorkspaceAvatar name={name} size="sm" />
        <div className="min-w-0 grow">
          <div className="flex min-w-0 items-center gap-1 pr-0.5">
            <span
              className="max-w-30 min-w-0 shrink truncate system-sm-medium text-text-primary"
              title={name}
            >
              {name}
            </span>
            {showStatus && <span className="flex shrink-0 items-center">{status}</span>}
          </div>
        </div>
        <span
          aria-hidden
          className="i-ri-expand-up-down-line h-4 w-4 shrink-0 text-text-tertiary"
        />
      </PopoverTrigger>
      {showCloudBilling && (
        <div className="flex items-center justify-center gap-1.5 border-t border-divider-subtle py-2 pr-2.5 pl-2">
          {credits !== null && (
            <Link
              href={creditsHref}
              className="flex min-w-0 flex-1 items-center gap-0.5 px-1 text-left text-text-tertiary transition-colors hover:text-text-secondary focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden"
              aria-label={
                isUnlimited
                  ? formattedCredits
                  : t(($) => $['mainNav.workspace.credits'], { ns: 'common', count: credits })
              }
            >
              <span className="i-custom-vender-main-nav-credits h-3 w-3 shrink-0" aria-hidden />
              <WorkspaceCreditsLabel
                credits={formattedCredits}
                unit={isUnlimited ? undefined : creditsUnit}
              />
            </Link>
          )}
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
            <PopoverTitle
              className="w-full min-w-0 truncate text-base/5 font-medium text-text-primary"
              title={name}
            >
              {name}
            </PopoverTitle>
            {status}
          </div>
          <WorkspaceAvatar name={name} size="lg" />
        </div>
        <button
          type="button"
          className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1 text-left outline-hidden hover:bg-state-base-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
          onClick={onOpenSettings}
        >
          <WorkspaceMenuItemContent
            icon={
              <span aria-hidden className="i-custom-vender-main-nav-workspace-settings h-4 w-4" />
            }
            label={settingsLabel}
          />
        </button>
        {showInviteMembers && (
          <button
            type="button"
            className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1 text-left outline-hidden hover:bg-state-base-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
            onClick={onInviteMembers}
          >
            <WorkspaceMenuItemContent
              icon={<span aria-hidden className="i-ri-user-add-line h-4 w-4" />}
              label={inviteMembersLabel}
            />
          </button>
        )}
      </div>
    </div>
  )
}

type CurrentWorkspaceCardSource = Pick<
  GetWorkspacesCurrentSummaryResponse,
  'id' | 'name' | 'plan' | 'credits'
>

const selectCurrentWorkspaceCardData = (workspace: CurrentWorkspaceCardSource) => ({
  id: workspace.id,
  name: workspace.name,
  plan: workspace.plan,
  credits: workspace.credits,
})

export function WorkspaceCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const currentWorkspaceQuery = useQuery(
    consoleQuery.workspaces.current.summary.get.queryOptions({
      select: selectCurrentWorkspaceCardData,
    }),
  )
  const [open, setOpen] = useState(false)
  const workspacesQueryOptions = consoleQuery.workspaces.get.queryOptions()
  const workspacesQuery = useQuery({
    ...workspacesQueryOptions,
    enabled: open,
  })
  const switchWorkspaceMutation = useMutation(consoleQuery.workspaces.switch.post.mutationOptions())
  const currentWorkspace = currentWorkspaceQuery.data
  const workspaces = workspacesQuery.data?.workspaces
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { setShowPricingModal } = useModalContext()
  const [, setSettingsDestination] = useQueryState(settingsQueryParamName, settingsQueryParser)
  const isCloudEdition = deploymentEdition === 'CLOUD'
  const prefetchWorkspaces = () => {
    void queryClient.prefetchQuery(workspacesQueryOptions)
  }

  if (currentWorkspaceQuery.isPending || !currentWorkspace?.name) {
    return (
      <WorkspaceCardSkeleton showCloudBilling={isCloudEdition} showPlanAction={isCloudEdition} />
    )
  }

  const workspacePlan = currentWorkspace.plan
  const hasBillingPlan = workspacePlan !== null
  const showCloudBilling = isCloudEdition && hasBillingPlan
  const showPlanAction = showCloudBilling
  const isFreePlan = workspacePlan === 'sandbox'
  const planActionLabel = t(
    ($) => $[isFreePlan ? 'upgradeBtn.encourageShort' : 'upgradeBtn.plain'],
    { ns: 'billing' },
  )
  const showInviteMembers = hasPermission(workspacePermissionKeys, 'workspace.member.manage')
  const renderWorkspaceStatus = () => {
    if (deploymentEdition === 'CLOUD')
      return workspacePlan ? <WorkspacePlanBadge plan={workspacePlan} /> : null
    if (deploymentEdition === 'ENTERPRISE') return <LicenseBadge />
    return null
  }

  const handleSwitchWorkspace = async (tenant_id: string) => {
    try {
      if (currentWorkspace.id === tenant_id) return

      await switchWorkspaceMutation.mutateAsync({ body: { tenant_id } })
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      location.assign(`${location.origin}${basePath}`)
    } catch {
      toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <>
        <WorkspaceCardTrigger
          name={currentWorkspace.name}
          status={renderWorkspaceStatus()}
          credits={currentWorkspace.credits}
          showCloudBilling={showCloudBilling}
          showPlanAction={showPlanAction}
          planActionLabel={planActionLabel}
          creditsHref={buildIntegrationPath('provider')}
          onPrefetchWorkspaces={prefetchWorkspaces}
          onPlanClick={setShowPricingModal}
        />
        <PopoverContent
          placement="bottom-start"
          sideOffset={-workspaceMenuTriggerHeight}
          alignOffset={workspaceMenuAlignOffset}
          className="w-[280px] overflow-hidden bg-components-panel-bg-blur! p-0! backdrop-blur-[5px]"
        >
          <WorkspaceMenuHeader
            name={currentWorkspace.name}
            status={renderWorkspaceStatus()}
            showInviteMembers={showInviteMembers}
            settingsLabel={t(($) => $['mainNav.workspace.settings'], { ns: 'common' })}
            inviteMembersLabel={t(($) => $['mainNav.workspace.inviteMembers'], { ns: 'common' })}
            onOpenSettings={() => {
              setOpen(false)
              setSettingsDestination(hasBillingPlan ? 'billing' : 'members')
            }}
            onInviteMembers={() => {
              setOpen(false)
              setSettingsDestination('members')
            }}
          />
          <WorkspaceSwitcher
            workspaces={workspaces}
            isPending={workspacesQuery.isPending}
            onSwitchWorkspace={(workspaceId) => {
              setOpen(false)
              void handleSwitchWorkspace(workspaceId)
            }}
          />
        </PopoverContent>
      </>
    </Popover>
  )
}
