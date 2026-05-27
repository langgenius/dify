'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import LicenseNav from '@/app/components/header/license-env'
import { buildIntegrationPath } from '@/app/components/tools/integration-routes'
import { IS_CLOUD_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useWorkspacesContext } from '@/context/workspace-context'
import { useRouter } from '@/next/navigation'
import { switchWorkspace } from '@/service/common'
import { basePath } from '@/utils/var'
import { formatCredits, getRemainingCredits, getWorkspaceInitial } from '../utils'
import WorkspacePlanBadge from './workspace-plan-badge'

function WorkspaceIcon({
  name,
  className,
}: {
  name?: string
  className?: string
}) {
  return (
    <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-components-icon-bg-orange-dark-solid text-white shadow-xs', className)}>
      <span className="system-md-semibold">{getWorkspaceInitial(name)}</span>
    </div>
  )
}

function WorkspaceMenuItemContent({
  icon,
  label,
  trailing,
}: {
  icon: ReactNode
  label: ReactNode
  trailing?: ReactNode
}) {
  const labelTitle = typeof label === 'string' ? label : undefined

  return (
    <>
      <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center text-text-tertiary">{icon}</span>
      <span className="min-w-0 grow truncate text-left system-md-regular text-text-secondary" title={labelTitle}>{label}</span>
      {trailing}
    </>
  )
}

const workspaceMenuTriggerHeight = 36

function WorkspaceCardTrigger({
  open,
  name,
  status,
  credits,
  showCloudBilling,
  showPlanAction,
  planActionLabel,
  onCreditsClick,
  onPlanClick,
}: {
  open: boolean
  name: string
  status: ReactNode
  credits: string
  showCloudBilling: boolean
  showPlanAction: boolean
  planActionLabel: string
  onCreditsClick: () => void
  onPlanClick: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="overflow-hidden rounded-xl border border-components-card-border bg-components-card-bg text-left shadow-xs transition-colors hover:bg-components-card-bg-alt">
      <DropdownMenuTrigger
        aria-label={t('mainNav.workspace.openMenu', { ns: 'common' })}
        className={cn(
          'flex w-full items-center gap-1.5 py-1.5 pr-3 pl-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-components-input-border-active focus-visible:ring-offset-1 focus-visible:outline-hidden',
          open && 'bg-linear-to-b from-background-section-burn to-background-section',
        )}
      >
        <WorkspaceIcon name={name} className="h-6 w-6 rounded-lg" />
        <div className="min-w-0 grow">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="max-w-30 truncate system-sm-medium text-text-primary" title={name}>{name}</span>
            {status}
          </div>
        </div>
        <span aria-hidden className="i-ri-expand-up-down-line h-4 w-4 shrink-0 text-text-tertiary" />
      </DropdownMenuTrigger>
      {showCloudBilling && (
        <div className="flex items-center justify-center gap-1.5 border-t border-divider-subtle py-2 pr-2.5 pl-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-0.5 px-1 text-left text-text-tertiary transition-colors hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-components-input-border-active focus-visible:ring-offset-1 focus-visible:outline-hidden"
            aria-label={t('mainNav.workspace.credits', { ns: 'common', count: credits })}
            onClick={onCreditsClick}
          >
            <span className="i-custom-vender-main-nav-credits h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate system-xs-medium" title={credits}>{credits}</span>
            <span className="shrink-0 system-xs-regular">{t('mainNav.workspace.creditsUnit', { ns: 'common' })}</span>
          </button>
          {showPlanAction && (
            <button
              type="button"
              className="max-w-30 shrink-0 truncate px-1 system-xs-semibold-uppercase text-saas-dify-blue-accessible transition-colors hover:text-saas-dify-blue-static-hover focus-visible:ring-2 focus-visible:ring-components-input-border-active focus-visible:ring-offset-1 focus-visible:outline-hidden"
              title={planActionLabel}
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
  showWorkspaceSettings,
  showInviteMembers,
  settingsLabel,
  inviteMembersLabel,
  onOpenSettings,
  onInviteMembers,
}: {
  name: string
  status: ReactNode
  showWorkspaceSettings: boolean
  showInviteMembers: boolean
  settingsLabel: ReactNode
  inviteMembersLabel: ReactNode
  onOpenSettings: () => void
  onInviteMembers: () => void
}) {
  return (
    <DropdownMenuGroup className="p-1">
      <div className="rounded-xl border-[0.5px] border-components-panel-border bg-linear-to-b from-background-section-burn to-background-section pb-2">
        <div className="flex h-16 items-center gap-2 px-3">
          <div className="flex min-w-0 grow flex-col items-start justify-center gap-1">
            <div className="max-w-44 shrink-0 truncate text-base/5 font-medium text-text-primary" title={name}>{name}</div>
            {status}
          </div>
          <WorkspaceIcon name={name} className="h-9 w-9" />
        </div>
        {showWorkspaceSettings && (
          <DropdownMenuItem
            className="mx-0 h-8 gap-1 px-3 py-1"
            onClick={onOpenSettings}
          >
            <WorkspaceMenuItemContent icon={<span aria-hidden className="i-custom-vender-main-nav-workspace-settings h-4 w-4" />} label={settingsLabel} />
          </DropdownMenuItem>
        )}
        {showInviteMembers && (
          <DropdownMenuItem
            className="mx-0 h-8 gap-1 px-3 py-1"
            onClick={onInviteMembers}
          >
            <WorkspaceMenuItemContent icon={<span aria-hidden className="i-ri-user-add-line h-4 w-4" />} label={inviteMembersLabel} />
          </DropdownMenuItem>
        )}
      </div>
    </DropdownMenuGroup>
  )
}

export function WorkspaceCard() {
  const { t } = useTranslation()
  const router = useRouter()
  const { currentWorkspace, isCurrentWorkspaceDatasetOperator, isCurrentWorkspaceManager } = useAppContext()
  const { workspaces } = useWorkspacesContext()
  const { enableBilling, plan } = useProviderContext()
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext()
  const credits = getRemainingCredits(currentWorkspace.trial_credits, currentWorkspace.trial_credits_used)
  const formattedCredits = formatCredits(credits)
  const workspacePlan = (workspaces.find(workspace => workspace.current)?.plan || currentWorkspace.plan || plan.type) as Plan
  const isFreePlan = workspacePlan === Plan.sandbox
  const showCloudBilling = IS_CLOUD_EDITION && enableBilling
  const showPlanAction = showCloudBilling
  const planActionLabel = t(isFreePlan ? 'upgradeBtn.encourageShort' : 'upgradeBtn.plain', { ns: 'billing' })
  const showWorkspaceSettings = !isCurrentWorkspaceDatasetOperator
  const showInviteMembers = showWorkspaceSettings && isCurrentWorkspaceManager
  const [open, setOpen] = useState(false)
  const renderWorkspaceStatus = () => enableBilling ? <WorkspacePlanBadge plan={workspacePlan} /> : <LicenseNav />

  const handleSwitchWorkspace = async (tenant_id: string) => {
    try {
      if (currentWorkspace.id === tenant_id)
        return

      await switchWorkspace({ url: '/workspaces/switch', body: { tenant_id } })
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      location.assign(`${location.origin}${basePath}`)
    }
    catch {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <>
        <WorkspaceCardTrigger
          open={open}
          name={currentWorkspace.name}
          status={renderWorkspaceStatus()}
          credits={formattedCredits}
          showCloudBilling={showCloudBilling}
          showPlanAction={showPlanAction}
          planActionLabel={planActionLabel}
          onCreditsClick={() => router.push(buildIntegrationPath('provider'))}
          onPlanClick={setShowPricingModal}
        />
        <DropdownMenuContent
          placement="bottom-start"
          sideOffset={-workspaceMenuTriggerHeight}
          popupClassName="w-(--anchor-width) overflow-hidden bg-components-panel-bg-blur! p-0! backdrop-blur-[5px]"
        >
          <WorkspaceMenuHeader
            name={currentWorkspace.name}
            status={renderWorkspaceStatus()}
            showWorkspaceSettings={showWorkspaceSettings}
            showInviteMembers={showInviteMembers}
            settingsLabel={t('mainNav.workspace.settings', { ns: 'common' })}
            inviteMembersLabel={t('mainNav.workspace.inviteMembers', { ns: 'common' })}
            onOpenSettings={() => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.BILLING })}
            onInviteMembers={() => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.MEMBERS })}
          />
          {workspaces.length > 0 && (
            <DropdownMenuGroup className="p-1 pb-2">
              <DropdownMenuLabel className="mx-0 h-6 px-3 py-1.5">
                {t('mainNav.workspace.switchWorkspace', { ns: 'common' })}
              </DropdownMenuLabel>
              {workspaces.map(workspace => (
                <DropdownMenuItem
                  key={workspace.id}
                  title={workspace.name}
                  className={cn(
                    'mx-0 h-8 gap-2 px-3 py-1',
                    workspace.current && 'bg-state-base-hover',
                  )}
                  onClick={() => {
                    void handleSwitchWorkspace(workspace.id)
                  }}
                >
                  <WorkspaceMenuItemContent
                    icon={<WorkspaceIcon name={workspace.name} className="h-5 w-5 rounded-md" />}
                    label={workspace.name}
                    trailing={workspace.current ? <span aria-hidden className="i-ri-check-line h-4 w-4 text-text-accent" /> : undefined}
                  />
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </>
    </DropdownMenu>
  )
}
