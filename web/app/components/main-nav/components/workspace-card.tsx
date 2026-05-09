'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import LicenseNav from '@/app/components/header/license-env'
import { IS_CLOUD_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useWorkspacesContext } from '@/context/workspace-context'
import { switchWorkspace } from '@/service/common'
import { basePath } from '@/utils/var'
import { formatCredits, getRemainingCredits, getWorkspaceInitial } from '../utils'
import WorkspacePlanBadge from './workspace-plan-badge'

const WorkspaceIcon = ({
  name,
  className,
}: {
  name?: string
  className?: string
}) => (
  <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-components-icon-bg-orange-dark-solid text-white shadow-xs', className)}>
    <span className="system-md-semibold">{getWorkspaceInitial(name)}</span>
  </div>
)

const WorkspaceMenuItemContent = ({
  icon,
  label,
  trailing,
}: {
  icon: ReactNode
  label: ReactNode
  trailing?: ReactNode
}) => {
  const labelTitle = typeof label === 'string' ? label : undefined

  return (
    <>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-tertiary">{icon}</span>
      <span className="min-w-0 grow truncate text-left system-md-regular text-text-secondary" title={labelTitle}>{label}</span>
      {trailing}
    </>
  )
}

const WorkspaceCard = () => {
  const { t } = useTranslation()
  const { currentWorkspace, isCurrentWorkspaceDatasetOperator, isCurrentWorkspaceManager } = useAppContext()
  const { workspaces } = useWorkspacesContext()
  const { enableBilling, plan } = useProviderContext()
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext()
  const [open, setOpen] = useState(false)
  const credits = getRemainingCredits(currentWorkspace.trial_credits, currentWorkspace.trial_credits_used)
  const formattedCredits = formatCredits(credits)
  const workspacePlan = (workspaces.find(workspace => workspace.current)?.plan || currentWorkspace.plan || plan.type) as Plan
  const isFreePlan = plan.type === Plan.sandbox
  const showCloudBilling = IS_CLOUD_EDITION && enableBilling
  const showUpgradeAction = showCloudBilling && isFreePlan
  const showWorkspaceSettings = !isCurrentWorkspaceDatasetOperator
  const showInviteMembers = showWorkspaceSettings && isCurrentWorkspaceManager
  const renderWorkspaceStatus = () => enableBilling ? <WorkspacePlanBadge plan={workspacePlan} /> : <LicenseNav />

  const handlePlanClick = () => {
    if (isFreePlan)
      setShowPricingModal()
    else
      setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.BILLING })
  }

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
    <div
      className={cn(
        'relative w-full',
        open && 'z-20',
      )}
    >
      <div
        className={cn(
          'overflow-hidden rounded-xl border border-components-card-border bg-components-card-bg text-left shadow-xs transition-colors',
          open ? 'pointer-events-none invisible' : 'hover:bg-components-card-bg-alt',
        )}
      >
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-1.5 py-1.5 pr-3 pl-1.5 text-left transition-colors',
            open && 'bg-gradient-to-b from-background-section-burn to-background-section',
          )}
          aria-expanded={open}
          aria-label={t('mainNav.workspace.openMenu', { ns: 'common' })}
          onClick={() => setOpen(value => !value)}
        >
          <WorkspaceIcon name={currentWorkspace.name} className="h-6 w-6 rounded-lg" />
          <div className="min-w-0 grow">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="max-w-[120px] truncate system-sm-medium text-text-primary" title={currentWorkspace.name}>{currentWorkspace.name}</span>
              {renderWorkspaceStatus()}
            </div>
          </div>
          <span aria-hidden className="i-ri-expand-up-down-line h-4 w-4 shrink-0 text-text-tertiary" />
        </button>
        {showCloudBilling && (
          <div className="flex items-center justify-center gap-1.5 border-t border-divider-subtle py-2 pr-2.5 pl-2">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-0.5 px-1 text-left text-text-tertiary transition-colors hover:text-text-secondary"
              aria-label={t('mainNav.workspace.credits', { ns: 'common', count: formattedCredits })}
              onClick={(e) => {
                e.stopPropagation()
                setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PROVIDER })
              }}
            >
              <span className="i-custom-vender-main-nav-credits h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate system-xs-medium" title={formattedCredits}>{formattedCredits}</span>
              <span className="shrink-0 system-xs-regular">{t('mainNav.workspace.creditsUnit', { ns: 'common' })}</span>
            </button>
            {showUpgradeAction && (
              <button
                type="button"
                className="max-w-[120px] shrink-0 truncate px-1 system-xs-semibold-uppercase text-saas-dify-blue-accessible transition-colors hover:text-saas-dify-blue-static-hover"
                title={t('upgradeBtn.encourageShort', { ns: 'billing' })}
                onClick={(e) => {
                  e.stopPropagation()
                  handlePlanClick()
                }}
              >
                {t('upgradeBtn.encourageShort', { ns: 'billing' })}
              </button>
            )}
          </div>
        )}
      </div>
      {open && (
        <div className="absolute top-0 right-0 left-0 z-20 flex flex-col overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]">
          <div className="rounded-xl bg-gradient-to-b from-background-section-burn to-background-section pb-2">
            <button
              type="button"
              className="flex w-full items-start gap-2 rounded-xl p-3 text-left transition-colors hover:bg-state-base-hover"
              aria-expanded={open}
              aria-label={t('mainNav.workspace.openMenu', { ns: 'common' })}
              onClick={() => setOpen(false)}
            >
              <div className="flex min-w-0 grow flex-col items-start justify-center gap-1">
                <div className="max-w-[120px] shrink-0 truncate system-xl-medium leading-5 text-text-primary" title={currentWorkspace.name}>{currentWorkspace.name}</div>
                {renderWorkspaceStatus()}
              </div>
              <WorkspaceIcon name={currentWorkspace.name} className="h-9 w-9" />
            </button>
            {showWorkspaceSettings && (
              <button
                type="button"
                className="flex h-8 w-full items-center gap-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-state-base-hover"
                onClick={() => {
                  setOpen(false)
                  setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.BILLING })
                }}
              >
                <WorkspaceMenuItemContent icon={<span aria-hidden className="i-custom-vender-main-nav-workspace-settings h-4 w-4" />} label={t('mainNav.workspace.settings', { ns: 'common' })} />
              </button>
            )}
            {showInviteMembers && (
              <button
                type="button"
                className="flex h-8 w-full items-center gap-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-state-base-hover"
                onClick={() => {
                  setOpen(false)
                  setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.MEMBERS })
                }}
              >
                <WorkspaceMenuItemContent icon={<span aria-hidden className="i-ri-user-add-line h-4 w-4" />} label={t('mainNav.workspace.inviteMembers', { ns: 'common' })} />
              </button>
            )}
          </div>
          {workspaces.length > 0 && (
            <div className="mt-1 flex flex-col">
              <div className="px-3 py-1.5 system-xs-medium-uppercase text-text-tertiary">
                {t('mainNav.workspace.switchWorkspace', { ns: 'common' })}
              </div>
              {workspaces.map(workspace => (
                <button
                  type="button"
                  key={workspace.id}
                  title={workspace.name}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-lg px-3 py-1 text-left transition-colors hover:bg-state-base-hover',
                    workspace.current && 'text-text-secondary',
                  )}
                  onClick={() => {
                    setOpen(false)
                    void handleSwitchWorkspace(workspace.id)
                  }}
                >
                  <WorkspaceMenuItemContent
                    icon={<WorkspaceIcon name={workspace.name} className="h-5 w-5 rounded-md" />}
                    label={workspace.name}
                    trailing={workspace.current ? <span aria-hidden className="i-ri-check-line h-4 w-4 text-text-accent" /> : undefined}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default WorkspaceCard
