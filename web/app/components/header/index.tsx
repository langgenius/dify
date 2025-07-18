'use client'
import { useCallback } from 'react'
import Link from 'next/link'
import AccountDropdown from './account-dropdown'
import AppNav from './app-nav'
import DatasetNav from './dataset-nav'
import EnvNav from './env-nav'
import PluginsNav from './plugins-nav'
import ExploreNav from './explore-nav'
import ToolsNav from './tools-nav'
import { WorkspaceProvider } from '@/context/workspace-context'
import { useAppContext } from '@/context/app-context'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import WorkplaceSelector from '@/app/components/header/account-dropdown/workplace-selector'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useProviderContext } from '@/context/provider-context'
import { useModalContext } from '@/context/modal-context'
import PlanBadge from './plan-badge'
import LicenseNav from './license-env'
import { Plan } from '../billing/type'
import { useGlobalPublicStore } from '@/context/global-public-context'

const navClassName = `
  flex items-center relative px-3 h-8 rounded-xl
  font-medium text-sm
  cursor-pointer
`

const Header = () => {
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator } = useAppContext()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const { enableBilling, plan } = useProviderContext()
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const isFreePlan = plan.type === Plan.sandbox
  const handlePlanClick = useCallback(() => {
    if (isFreePlan)
      setShowPricingModal()
    else
      setShowAccountSettingModal({ payload: 'billing' })
  }, [isFreePlan, setShowAccountSettingModal, setShowPricingModal])

  if (isMobile) {
    return (
      <div className=''>
        <div className='flex items-center justify-between px-2'>
          <div className='flex items-center'>
            <Link href="/apps" className='flex h-8 shrink-0 items-center justify-center px-0.5'>
              {systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
                ? <img
                  src={systemFeatures.branding.workspace_logo}
                  className='block h-[22px] w-auto object-contain'
                  alt='logo'
                />
                : <DifyLogo />}
            </Link>
            <div className='mx-1.5 shrink-0 font-light text-divider-deep'>/</div>
            <WorkspaceProvider>
              <WorkplaceSelector />
            </WorkspaceProvider>
            {enableBilling ? <PlanBadge allowHover sandboxAsUpgrade plan={plan.type} onClick={handlePlanClick} /> : <LicenseNav />}
          </div>
          <div className='flex items-center'>
            <div className='mr-2'>
              <PluginsNav />
            </div>
            <AccountDropdown />
          </div>
        </div>
        <div className='my-1 flex items-center justify-center space-x-1'>
          {!isCurrentWorkspaceDatasetOperator && <ExploreNav className={navClassName} />}
          {!isCurrentWorkspaceDatasetOperator && <AppNav />}
          {(isCurrentWorkspaceEditor || isCurrentWorkspaceDatasetOperator) && <DatasetNav />}
          {!isCurrentWorkspaceDatasetOperator && <ToolsNav className={navClassName} />}
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-[56px] items-center'>
      <div className='flex min-w-0 flex-[1]  items-center pl-3 pr-2 min-[1280px]:pr-3'>
        <Link href="/apps" className='flex h-8 shrink-0 items-center justify-center px-0.5'>
          {systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
            ? <img
              src={systemFeatures.branding.workspace_logo}
              className='block h-[22px] w-auto object-contain'
              alt='logo'
            />
            : <DifyLogo />}
        </Link>
        <div className='mx-1.5 shrink-0 font-light text-divider-deep'>/</div>
        <WorkspaceProvider>
          <WorkplaceSelector />
        </WorkspaceProvider>
        {enableBilling ? <PlanBadge allowHover sandboxAsUpgrade plan={plan.type} onClick={handlePlanClick} /> : <LicenseNav />}
      </div>
      <div className='flex items-center space-x-2'>
        {!isCurrentWorkspaceDatasetOperator && <ExploreNav className={navClassName} />}
        {!isCurrentWorkspaceDatasetOperator && <AppNav />}
        {(isCurrentWorkspaceEditor || isCurrentWorkspaceDatasetOperator) && <DatasetNav />}
        {!isCurrentWorkspaceDatasetOperator && <ToolsNav className={navClassName} />}
      </div>
      <div className='flex min-w-0 flex-[1] items-center justify-end pl-2 pr-3 min-[1280px]:pl-3'>
        <EnvNav />
        <div className='mr-2'>
          <PluginsNav />
        </div>
        <AccountDropdown />
      </div>
    </div>
  )
}
export default Header
