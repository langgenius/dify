'use client'
import { useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useBoolean } from 'ahooks'
import { useSelectedLayoutSegment } from 'next/navigation'
import { Bars3Icon } from '@heroicons/react/20/solid'
import { SparklesSoft } from '@/app/components/base/icons/src/public/common'
import PremiumBadge from '../base/premium-badge'
import AccountDropdown from './account-dropdown'
import AppNav from './app-nav'
import DatasetNav from './dataset-nav'
import EnvNav from './env-nav'
import PluginsNav from './plugins-nav'
import ExploreNav from './explore-nav'
import ToolsNav from './tools-nav'
import LicenseNav from './license-env'
import { WorkspaceProvider } from '@/context/workspace-context'
import { useAppContext } from '@/context/app-context'
import LogoSite from '@/app/components/base/logo/logo-site'
import WorkplaceSelector from '@/app/components/header/account-dropdown/workplace-selector'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useProviderContext } from '@/context/provider-context'
import { useModalContext } from '@/context/modal-context'
import { useTranslation } from 'react-i18next'

const navClassName = `
  flex items-center relative mr-0 sm:mr-3 px-3 h-8 rounded-xl
  font-medium text-sm
  cursor-pointer
`

const Header = () => {
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator } = useAppContext()
  const { t } = useTranslation()

  const selectedSegment = useSelectedLayoutSegment()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const [isShowNavMenu, { toggle, setFalse: hideNavMenu }] = useBoolean(false)
  const { enableBilling, plan } = useProviderContext()
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext()
  const isFreePlan = plan.type === 'sandbox'
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
    <div className='flex flex-1 items-center justify-between px-4 bg-background-body'>
      <div className='flex items-center'>
        {isMobile && <div
          className='flex items-center justify-center h-8 w-8 cursor-pointer'
          onClick={toggle}
        >
          <Bars3Icon className="h-4 w-4 text-gray-500" />
        </div>}
        {
          !isMobile
          && <div className='flex w-64 p-2 pl-3 gap-1.5 items-center shrink-0 self-stretch'>
            <Link href="/apps" className='flex w-8 h-8 items-center justify-center gap-2 shrink-0'>
              <LogoSite className='object-contain' />
            </Link>
            <div className='font-light text-divider-deep'>/</div>
            <div className='flex items-center gap-0.5'>
              <WorkspaceProvider>
                <WorkplaceSelector />
              </WorkspaceProvider>
              {enableBilling && (
                <div className='select-none'>
                  <PremiumBadge color='blue' allowHover={true} onClick={handlePlanClick}>
                    <SparklesSoft className='flex items-center py-[1px] pl-[3px] w-3.5 h-3.5 text-components-premium-badge-indigo-text-stop-0' />
                    <div className='system-xs-medium'>
                      <span className='p-1'>
                        {t('billing.upgradeBtn.encourageShort')}
                      </span>
                    </div>
                  </PremiumBadge>
                </div>
              )}
            </div>
          </div>
        }
      </div >
      {isMobile && (
        <div className='flex'>
          <Link href="/apps" className='flex items-center mr-4'>
            <LogoSite />
          </Link>
          <div className='font-light text-divider-deep'>/</div>
          {
            enableBilling && (
              <div className='select-none'>
                <PremiumBadge color='blue' allowHover={true} onClick={handlePlanClick}>
                  <SparklesSoft className='flex items-center py-[1px] pl-[3px] w-3.5 h-3.5 text-components-premium-badge-indigo-text-stop-0' />
                  <div className='system-xs-medium'>
                    <span className='p-1'>
                      {t('billing.upgradeBtn.encourageShort')}
                    </span>
                  </div>
                </PremiumBadge>
              </div>
            )
          }
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
      <div className='flex items-center shrink-0'>
        <LicenseNav />
        <EnvNav />
        <div className='mr-3'>
          <PluginsNav />
        </div>
        <AccountDropdown isMobile={isMobile} />
      </div>
      {
        (isMobile && isShowNavMenu) && (
          <div className='w-full flex flex-col p-2 gap-y-1'>
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
