'use client'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import WorkplaceSelector from '@/app/components/header/account-dropdown/workplace-selector'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { WorkspaceProvider } from '@/context/workspace-context-provider'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Link from '@/next/link'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { hasPermission } from '@/utils/permission'
import { Plan } from '../billing/type'
import AccountDropdown from './account-dropdown'
import AppNav from './app-nav'
import DatasetNav from './dataset-nav'
import EnvNav from './env-nav'
import ExploreNav from './explore-nav'
import LicenseNav from './license-env'
import { PlanBadge } from './plan-badge'
import PluginsNav from './plugins-nav'
import ToolsNav from './tools-nav'

const navClassName = `
  flex items-center relative px-3 h-8 rounded-xl
  font-medium text-sm
  cursor-pointer
`

const Header = () => {
  const workspacePermissionKeys = useAppContextSelector(s => s.workspacePermissionKeys)
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const { enableBilling, plan } = useProviderContext()
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isFreePlan = plan.type === Plan.sandbox
  const isBrandingEnabled = systemFeatures.branding.enabled
  const handlePlanClick = useCallback(() => {
    if (isFreePlan)
      setShowPricingModal()
    else
      setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.BILLING })
  }, [isFreePlan, setShowAccountSettingModal, setShowPricingModal])

  const canAccessExplorePage = hasPermission(workspacePermissionKeys, 'page.explore.access')
  const canAccessAppsPage = hasPermission(workspacePermissionKeys, 'app_library.access')
  const canAccessDatasetsPage = hasPermission(workspacePermissionKeys, ['dataset.create', 'dataset.tag.manage', 'dataset.external.connect'])
  const canAccessToolsPage = hasPermission(workspacePermissionKeys, 'page.tool.access')

  const renderLogo = () => (
    <h1>
      <Link href="/apps" className="flex h-8 shrink-0 items-center justify-center overflow-hidden px-0.5 -indent-2499.75 whitespace-nowrap">
        {isBrandingEnabled && systemFeatures.branding.application_title ? systemFeatures.branding.application_title : 'Dify'}
        {systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
          ? (
              <img
                src={systemFeatures.branding.workspace_logo}
                className="block h-5.5 w-auto object-contain"
                alt="logo"
              />
            )
          : <DifyLogo />}
      </Link>
    </h1>
  )

  if (isMobile) {
    return (
      <div className="">
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center">
            {renderLogo()}
            <div className="mx-1.5 shrink-0 font-light text-divider-deep">/</div>
            <WorkspaceProvider>
              <WorkplaceSelector />
            </WorkspaceProvider>
            {enableBilling ? <PlanBadge allowHover sandboxAsUpgrade plan={plan.type} onClick={handlePlanClick} /> : <LicenseNav />}
          </div>
          <div className="flex items-center">
            <div className="mr-2">
              <PluginsNav />
            </div>
            <AccountDropdown />
          </div>
        </div>
        <div className="my-1 flex items-center justify-center space-x-1">
          {canAccessExplorePage && <ExploreNav className={navClassName} />}
          {canAccessAppsPage && <AppNav />}
          {canAccessDatasetsPage && <DatasetNav />}
          {canAccessToolsPage && <ToolsNav className={navClassName} />}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-14 items-center">
      <div className="flex min-w-0 flex-1 items-center pr-2 pl-3 min-[1280px]:pr-3">
        {renderLogo()}
        <div className="mx-1.5 shrink-0 font-light text-divider-deep">/</div>
        <WorkspaceProvider>
          <WorkplaceSelector />
        </WorkspaceProvider>
        {enableBilling ? <PlanBadge allowHover sandboxAsUpgrade plan={plan.type} onClick={handlePlanClick} /> : <LicenseNav />}
      </div>
      <div className="flex items-center space-x-2">
        {canAccessExplorePage && <ExploreNav className={navClassName} />}
        {canAccessAppsPage && <AppNav />}
        {canAccessDatasetsPage && <DatasetNav />}
        {canAccessToolsPage && <ToolsNav className={navClassName} />}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end pr-3 pl-2 min-[1280px]:pl-3">
        <EnvNav />
        <div className="mr-2">
          <PluginsNav />
        </div>
        <AccountDropdown />
      </div>
    </div>
  )
}
export default Header
