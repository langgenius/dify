'use client'
import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useBoolean } from 'ahooks'
import { useSelectedLayoutSegment } from 'next/navigation'
import { Bars3Icon } from '@heroicons/react/20/solid'
import HeaderBillingBtn from '../billing/header-billing-btn'
import { SidebarBody, Sidebar as UISidebar } from '@/app/components/ui/sidebar'
import AccountDropdown from '@/app/components/header/account-dropdown'
import AppNav from '@/app/components/header/app-nav'
import DatasetNav from '@/app/components/header/dataset-nav'
import EnvNav from '@/app/components/header/env-nav'
import ExploreNav from '@/app/components/header/explore-nav'
import ToolsNav from '@/app/components/header/tools-nav'
import GithubStar from '@/app/components/header/github-star'
import { WorkspaceProvider } from '@/context/workspace-context'
import { useAppContext } from '@/context/app-context'
import LogoSite from '@/app/components/base/logo/logo-site'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useProviderContext } from '@/context/provider-context'
import { useModalContext } from '@/context/modal-context'

const navClassName = `
  flex items-center relative mr-0 sm:mr-3 px-3 h-8 rounded-xl
  font-medium text-sm
  cursor-pointer
`
type SideBarWrapperProps = { children: React.ReactNode }

export function SidebarWrapper({ children }: SideBarWrapperProps) {
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator } = useAppContext()
  const selectedSegment = useSelectedLayoutSegment()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const [isShowNavMenu, { toggle, setFalse: hideNavMenu }] = useBoolean(false)
  const { enableBilling, plan } = useProviderContext()
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext()
  const isFreePlan = plan.type === 'sandbox'
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile)

  const handlePlanClick = useCallback(() => {
    if (isFreePlan)
      setShowPricingModal()
    else
      setShowAccountSettingModal({ payload: 'billing' })
  }, [isFreePlan, setShowAccountSettingModal, setShowPricingModal])

  useEffect(() => {
    hideNavMenu()
  }, [selectedSegment, hideNavMenu])

  return (
    <div className="flex h-screen">
      <UISidebar open={sidebarOpen} setOpen={setSidebarOpen} animate={false}>
        <SidebarBody className="flex flex-col h-full">
          <div className="flex items-center justify-between p-4">
            <Link href="/apps" className="flex items-center">
              <LogoSite className="h-8 w-auto" />
            </Link>
            <GithubStar />
          </div>

          <nav className="flex-1 overflow-y-auto px-4">
            {!isMobile && (
              <div className="flex flex-col space-y-2">
                {!isCurrentWorkspaceDatasetOperator && <ExploreNav className={navClassName} />}
                {!isCurrentWorkspaceDatasetOperator && <AppNav />}
                {(isCurrentWorkspaceEditor || isCurrentWorkspaceDatasetOperator) && <DatasetNav />}
                {!isCurrentWorkspaceDatasetOperator && <ToolsNav className={navClassName} />}
              </div>
            )}
          </nav>

          <div className="mt-auto p-4 space-y-4">
            <EnvNav />
            {enableBilling && (
              <div className="select-none">
                <HeaderBillingBtn onClick={handlePlanClick} />
              </div>
            )}
            <WorkspaceProvider>
              <AccountDropdown isMobile={isMobile} />
            </WorkspaceProvider>
          </div>
        </SidebarBody>
      </UISidebar>

      <div className="flex-1 flex flex-col">
        {isMobile && (
          <>
            <div
              className="flex items-center justify-center h-8 w-8 cursor-pointer"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Bars3Icon className="h-6 w-6 text-gray-500" />
            </div>
            <Link href="/apps" className="flex items-center">
              <LogoSite className="h-8 w-auto" />
            </Link>
            <GithubStar />
          </>
        )}

        {(isMobile && isShowNavMenu) && (
          <div className="w-full flex flex-col bg-white dark:bg-gray-800 shadow">
            {!isCurrentWorkspaceDatasetOperator && <ExploreNav className={navClassName} />}
            {!isCurrentWorkspaceDatasetOperator && <AppNav />}
            {(isCurrentWorkspaceEditor || isCurrentWorkspaceDatasetOperator) && <DatasetNav />}
            {!isCurrentWorkspaceDatasetOperator && <ToolsNav className={navClassName} />}
          </div>
        )}

        {children}
      </div>
    </div>
  )
}
