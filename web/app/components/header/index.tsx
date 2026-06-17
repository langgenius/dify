'use client'
import { useSuspenseQuery } from '@tanstack/react-query'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import WorkplaceSelector from '@/app/components/header/account-dropdown/workplace-selector'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useAppContext } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { DeploymentsNav } from '@/features/deployments/nav'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Link from '@/next/link'
import { Plan } from '../billing/type'
import AccountDropdown from './account-dropdown'
import AppNav from './app-nav'
import { DatasetNav } from './dataset-nav'
import EnvNav from './env-nav'
import { ExploreNav } from './explore-nav'
import LicenseNav from './license-env'
import { PlanBadge } from './plan-badge'
import PluginsNav from './plugins-nav'
import { ToolsNav } from './tools-nav'

const navClassName = `
  flex items-center relative px-3 h-8 rounded-xl
  font-medium text-sm
  cursor-pointer
`

export function Header() {
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator } = useAppContext()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const { enableBilling, plan } = useProviderContext()
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isFreePlan = plan.type === Plan.sandbox
  const isBrandingEnabled = systemFeatures.branding.enabled
  const canUseAppDeploy = isCurrentWorkspaceEditor && systemFeatures.enable_app_deploy

  function handlePlanClick() {
    if (isFreePlan)
      setShowPricingModal()
    else
      setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.BILLING })
  }

  const logoLabel = isBrandingEnabled && systemFeatures.branding.application_title ? systemFeatures.branding.application_title : 'Dify'
  const renderLogo = () => (
    <Link
      href="/apps"
      className="flex h-8 shrink-0 items-center justify-center overflow-hidden rounded-sm px-0.5 hover:opacity-80 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
      aria-label={logoLabel}
    >
      {systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
        ? (
            <img
              src={systemFeatures.branding.workspace_logo}
              className="block h-[22px] w-auto object-contain"
              alt=""
            />
          )
        : <DifyLogo alt="" />}
    </Link>
  )

  if (isMobile) {
    return (
      <div className="">
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center">
            {renderLogo()}
            <div className="mx-1.5 shrink-0 font-light text-divider-deep">/</div>
            <WorkplaceSelector />
            {enableBilling ? <PlanBadge allowHover sandboxAsUpgrade plan={plan.type} onClick={handlePlanClick} /> : <LicenseNav />}
          </div>
          <div className="flex items-center gap-2">
            <PluginsNav />
            <AccountDropdown />
          </div>
        </div>
        <div className="my-1 flex items-center justify-center gap-1">
          {!isCurrentWorkspaceDatasetOperator && <ExploreNav className={navClassName} />}
          {!isCurrentWorkspaceDatasetOperator && <AppNav />}
          {(isCurrentWorkspaceEditor || isCurrentWorkspaceDatasetOperator) && <DatasetNav />}
          {!isCurrentWorkspaceDatasetOperator && <ToolsNav className={navClassName} />}
          {canUseAppDeploy && <DeploymentsNav />}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[56px] items-center">
      <div className="flex min-w-0 flex-1 items-center overflow-hidden pr-2 pl-3 min-[1280px]:pr-3">
        {renderLogo()}
        <div className="mx-1.5 shrink-0 font-light text-divider-deep">/</div>
        <WorkplaceSelector />
        {enableBilling ? <PlanBadge allowHover sandboxAsUpgrade plan={plan.type} onClick={handlePlanClick} /> : <LicenseNav />}
      </div>
      <div className="flex min-w-0 items-center justify-center gap-2 overflow-hidden py-3">
        {!isCurrentWorkspaceDatasetOperator && <ExploreNav className={navClassName} />}
        {!isCurrentWorkspaceDatasetOperator && <AppNav />}
        {(isCurrentWorkspaceEditor || isCurrentWorkspaceDatasetOperator) && <DatasetNav />}
        {!isCurrentWorkspaceDatasetOperator && <ToolsNav className={navClassName} />}
        {canUseAppDeploy && <DeploymentsNav />}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 pr-3 pl-2 min-[1280px]:pl-3">
        <EnvNav />
        <PluginsNav />
        <AccountDropdown />
      </div>
    </div>
  )
}
