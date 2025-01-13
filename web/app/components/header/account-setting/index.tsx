'use client'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import {
  RiBox3Fill,
  RiBox3Line,
  RiCloseLine,
  RiColorFilterFill,
  RiColorFilterLine,
  RiDatabase2Fill,
  RiDatabase2Line,
  RiGroup2Fill,
  RiGroup2Line,
  RiMoneyDollarCircleFill,
  RiMoneyDollarCircleLine,
  RiPuzzle2Fill,
  RiPuzzle2Line,
  RiTranslate2,
} from '@remixicon/react'
import MembersPage from './members-page'
import LanguagePage from './language-page'
import ApiBasedExtensionPage from './api-based-extension-page'
import DataSourcePage from './data-source-page'
import ModelProviderPage from './model-provider-page'
import s from './index.module.css'
import cn from '@/utils/classnames'
import BillingPage from '@/app/components/billing/billing-page'
import CustomPage from '@/app/components/custom/custom-page'
import Modal from '@/app/components/base/modal'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useProviderContext } from '@/context/provider-context'
import { useAppContext } from '@/context/app-context'

const iconClassName = `
  w-4 h-4 ml-3 mr-2
`

const scrolledClassName = `
  border-b shadow-xs bg-white/[.98]
`

type IAccountSettingProps = {
  onCancel: () => void
  activeTab?: string
}

type GroupItem = {
  key: string
  name: string
  description?: string
  icon: JSX.Element
  activeIcon: JSX.Element
}

export default function AccountSetting({
  onCancel,
  activeTab = 'members',
}: IAccountSettingProps) {
  const [activeMenu, setActiveMenu] = useState(activeTab)
  const { t } = useTranslation()
  const { enableBilling, enableReplaceWebAppLogo } = useProviderContext()
  const { isCurrentWorkspaceDatasetOperator } = useAppContext()

  const workplaceGroupItems = (() => {
    if (isCurrentWorkspaceDatasetOperator)
      return []
    return [
      {
        key: 'provider',
        name: t('common.settings.provider'),
        icon: <RiBox3Line className={iconClassName} />,
        activeIcon: <RiBox3Fill className={iconClassName} />,
      },
      {
        key: 'members',
        name: t('common.settings.members'),
        icon: <RiGroup2Line className={iconClassName} />,
        activeIcon: <RiGroup2Fill className={iconClassName} />,
      },
      {
        // Use key false to hide this item
        key: enableBilling ? 'billing' : false,
        name: t('common.settings.billing'),
        description: t('billing.plansCommon.receiptInfo'),
        icon: <RiMoneyDollarCircleLine className={iconClassName} />,
        activeIcon: <RiMoneyDollarCircleFill className={iconClassName} />,
      },
      {
        key: 'data-source',
        name: t('common.settings.dataSource'),
        icon: <RiDatabase2Line className={iconClassName} />,
        activeIcon: <RiDatabase2Fill className={iconClassName} />,
      },
      {
        key: 'api-based-extension',
        name: t('common.settings.apiBasedExtension'),
        icon: <RiPuzzle2Line className={iconClassName} />,
        activeIcon: <RiPuzzle2Fill className={iconClassName} />,
      },
      {
        key: (enableReplaceWebAppLogo || enableBilling) ? 'custom' : false,
        name: t('custom.custom'),
        icon: <RiColorFilterLine className={iconClassName} />,
        activeIcon: <RiColorFilterFill className={iconClassName} />,
      },
    ].filter(item => !!item.key) as GroupItem[]
  })()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const menuItems = [
    {
      key: 'workspace-group',
      name: t('common.settings.workplaceGroup'),
      items: workplaceGroupItems,
    },
    {
      key: 'account-group',
      name: t('common.settings.accountGroup'),
      items: [
        {
          key: 'language',
          name: t('common.settings.language'),
          icon: <RiTranslate2 className={iconClassName} />,
          activeIcon: <RiTranslate2 className={iconClassName} />,
        },
      ],
    },
  ]
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const targetElement = scrollRef.current
    const scrollHandle = (e: Event) => {
      const userScrolled = (e.target as HTMLDivElement).scrollTop > 0
      setScrolled(userScrolled)
    }
    targetElement?.addEventListener('scroll', scrollHandle)
    return () => {
      targetElement?.removeEventListener('scroll', scrollHandle)
    }
  }, [])

  const activeItem = [...menuItems[0].items, ...menuItems[1].items].find(item => item.key === activeMenu)

  return (
    <Modal
      isShow
      onClose={() => { }}
      className={s.modal}
      wrapperClassName='pt-[60px]'
    >
      <div className='flex'>
        <div className='w-[44px] sm:w-[200px] px-[1px] py-4 sm:p-4 border border-divider-burn shrink-0 sm:shrink-1 flex flex-col items-center sm:items-start'>
          <div className='mb-8 ml-0 sm:ml-2 sm:text-base title-2xl-semi-bold text-text-primary'>{t('common.userProfile.settings')}</div>
          <div className='w-full'>
            {
              menuItems.map(menuItem => (
                <div key={menuItem.key} className='mb-4'>
                  {!isCurrentWorkspaceDatasetOperator && (
                    <div className='px-2 mb-[6px] sm:text-xs system-xs-medium-uppercase text-text-tertiary'>{menuItem.name}</div>
                  )}
                  <div>
                    {
                      menuItem.items.map(item => (
                        <div
                          key={item.key}
                          className={`
                            flex items-center h-[37px] mb-[2px] text-sm cursor-pointer rounded-lg
                            ${activeMenu === item.key ? 'system-sm-semibold text-components-menu-item-text-active bg-state-base-active' : 'system-sm-medium text-components-menu-item-text'}
                          `}
                          title={item.name}
                          onClick={() => setActiveMenu(item.key)}
                        >
                          {activeMenu === item.key ? item.activeIcon : item.icon}
                          {!isMobile && <div className='truncate'>{item.name}</div>}
                        </div>
                      ))
                    }
                  </div>
                </div>
              ))
            }
          </div>
        </div>
        <div ref={scrollRef} className='relative w-[824px] h-[720px] pb-4 overflow-y-auto'>
          <div className={cn('sticky top-0 px-6 py-4 flex items-center h-14 mb-4 bg-components-panel-bg title-2xl-semi-bold text-text-primary z-20', scrolled && scrolledClassName)}>
            <div className='shrink-0'>{activeItem?.name}</div>
            {
              activeItem?.description && (
                <div className='shrink-0 ml-2 text-xs text-gray-600'>{activeItem?.description}</div>
              )
            }
            <div className='grow flex justify-end'>
              <div className='z-[10] flex items-center justify-center -mr-4 p-2 cursor-pointer rounded-[10px] hover:bg-components-button-tertiary-bg' onClick={onCancel}>
                <RiCloseLine className='w-5 h-5 text-components-button-tertiary-text' />
              </div>
            </div>
          </div>
          <div className='px-4 sm:px-8 pt-2'>
            {activeMenu === 'members' && <MembersPage />}
            {activeMenu === 'billing' && <BillingPage />}
            {activeMenu === 'language' && <LanguagePage />}
            {activeMenu === 'provider' && <ModelProviderPage />}
            {activeMenu === 'data-source' && <DataSourcePage />}
            {activeMenu === 'api-based-extension' && <ApiBasedExtensionPage />}
            {activeMenu === 'custom' && <CustomPage />}
          </div>
        </div>
      </div>
    </Modal>
  )
}
