'use client'
import { useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useBoolean } from 'ahooks'
import { useSelectedLayoutSegment } from 'next/navigation'
import { Bars3Icon } from '@heroicons/react/20/solid'
import AccountDropdown from './account-dropdown'
import AppNav from './app-nav'
import DatasetNav from './dataset-nav'
import EnvNav from './env-nav'
import PluginsNav from './plugins-nav'
import ExploreNav from './explore-nav'
import ToolsNav from './tools-nav'
import { WorkspaceProvider } from '@/context/workspace-context'
import { useAppContext } from '@/context/app-context'
import LogoSite from '@/app/components/base/logo/logo-site'
import WorkplaceSelector from '@/app/components/header/account-dropdown/workplace-selector'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useProviderContext } from '@/context/provider-context'
import { useModalContext } from '@/context/modal-context'
import PlanBadge from './plan-badge'
import LicenseNav from './license-env'
import { Plan } from '../billing/type'

const navClassName = `
  flex items-center relative mr-0 sm:mr-3 px-3 h-8 rounded-xl
  font-medium text-sm
  cursor-pointer
`

const Header = () => {
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator } = useAppContext()
  const selectedSegment = useSelectedLayoutSegment()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const [isShowNavMenu, { toggle, setFalse: hideNavMenu }] = useBoolean(false)
  const { enableBilling, plan } = useProviderContext()
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext()
  const isFreePlan = plan.type === Plan.sandbox
  const handlePlanClick = useCallback(() => {
    if (isFreePlan)
      setShowPricingModal()
    else
      setShowAccountSettingModal({ payload: 'billing' })
  }, [isFreePlan, setShowAccountSettingModal, setShowPricingModal])

  useEffect(() => {
    hideNavMenu()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSegment])
  return (
    <div className='flex flex-1 items-center justify-between bg-background-body px-4'>
      <div className='flex items-center'>
        {isMobile && <div
          className='flex h-8 w-8 cursor-pointer items-center justify-center'
          onClick={toggle}
        >
          <Bars3Icon className="h-4 w-4 text-gray-500" />
        </div>}
        {
          !isMobile
          && <div className='flex w-64 shrink-0 items-center gap-1.5 self-stretch p-2 pl-3'>
            <Link href="/apps" className='flex h-8 w-8 shrink-0 items-center justify-center gap-2'>
              <LogoSite className='object-contain' />
            </Link>
            <div className='font-light text-divider-deep'>/</div>
            <div className='flex items-center gap-0.5'>
              <WorkspaceProvider>
                <WorkplaceSelector />
              </WorkspaceProvider>
              {enableBilling ? <PlanBadge allowHover sandboxAsUpgrade plan={plan.type} onClick={handlePlanClick} /> : <LicenseNav />}
            </div>
          </div>
        }
      </div >
      {isMobile && (
        <div className='flex'>
          <Link href="/apps" className='mr-4 flex items-center'>
            <LogoSite />
          </Link>
          <div className='font-light text-divider-deep'>/</div>
          {enableBilling ? <PlanBadge allowHover sandboxAsUpgrade plan={plan.type} onClick={handlePlanClick} /> : <LicenseNav />}
        </div >
      )}
      {
        !isMobile && (
          <div className='flex items-center'>
            {!isCurrentWorkspaceDatasetOperator && <ExploreNav className={navClassName} />}
            {!isCurrentWorkspaceDatasetOperator && <AppNav />}
            {(isCurrentWorkspaceEditor || isCurrentWorkspaceDatasetOperator) && <DatasetNav />}
            {!isCurrentWorkspaceDatasetOperator && <ToolsNav className={navClassName} />}
          </div>
        )
      }
      <div className='flex shrink-0 items-center'>
        <EnvNav />
        <div className='mr-2'>
          <PluginsNav />
        </div>
        <AccountDropdown />
      </div>
      {
        (isMobile && isShowNavMenu) && (
          <div className='flex w-full flex-col gap-y-1 p-2'>
            {!isCurrentWorkspaceDatasetOperator && <ExploreNav className={navClassName} />}
            {!isCurrentWorkspaceDatasetOperator && <AppNav />}
            {(isCurrentWorkspaceEditor || isCurrentWorkspaceDatasetOperator) && <DatasetNav />}
            {!isCurrentWorkspaceDatasetOperator && <ToolsNav className={navClassName} />}
          </div>
        )
      }
    </div >
  )
}
export default Header
