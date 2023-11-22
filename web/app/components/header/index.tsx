'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { useClickAway } from 'ahooks'
import HeaderBillingBtn from '../billing/header-billing-btn'
import AccountDropdown from './account-dropdown'
import AppNav from './app-nav'
import DatasetNav from './dataset-nav'
import EnvNav from './env-nav'
import ExploreNav from './explore-nav'
import GithubStar from './github-star'
import { WorkspaceProvider } from '@/context/workspace-context'
import { useAppContext } from '@/context/app-context'
import LogoSite from '@/app/components/base/logo/logo-site'
import PlanComp from '@/app/components/billing/plan'
import { IS_CLOUD_EDITION } from '@/config'

const navClassName = `
  flex items-center relative mr-3 px-3 h-8 rounded-xl
  font-medium text-sm
  cursor-pointer
`

const Header = () => {
  const { isCurrentWorkspaceManager } = useAppContext()
  const [showUpgradePanel, setShowUpgradePanel] = useState(false)
  const upgradeBtnRef = useRef<HTMLElement>(null)
  useClickAway(() => {
    setShowUpgradePanel(false)
  }, upgradeBtnRef)
  return (
    <>
      <div className='flex items-center'>
        <Link href="/apps" className='flex items-center mr-4'>
          <LogoSite />
        </Link>
        <GithubStar />
      </div>
      <div className='flex items-center'>
        <ExploreNav className={navClassName} />
        <AppNav />
        {isCurrentWorkspaceManager && <DatasetNav />}
      </div>
      <div className='flex items-center flex-shrink-0'>
        <EnvNav />
        {IS_CLOUD_EDITION && (
          <div className='mr-3 select-none'>
            <HeaderBillingBtn onClick={() => setShowUpgradePanel(true)} />
            {showUpgradePanel && (
              <div
                ref={upgradeBtnRef as any}
                className='fixed z-10 top-12 right-1 w-[360px]'
              >
                <PlanComp loc='header' />
              </div>
            )}
          </div>
        )}
        <WorkspaceProvider>
          <AccountDropdown />
        </WorkspaceProvider>
      </div>
    </>
  )
}
export default Header
