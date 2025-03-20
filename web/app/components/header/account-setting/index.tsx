'use client'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import {
  RiBrain2Fill,
  RiBrain2Line,
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
import Button from '../../base/button'
import MembersPage from './members-page'
import LanguagePage from './language-page'
import ApiBasedExtensionPage from './api-based-extension-page'
import DataSourcePage from './data-source-page'
import ModelProviderPage from './model-provider-page'
import cn from '@/utils/classnames'
import BillingPage from '@/app/components/billing/billing-page'
import CustomPage from '@/app/components/custom/custom-page'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useProviderContext } from '@/context/provider-context'
import { useAppContext } from '@/context/app-context'
import MenuDialog from '@/app/components/header/account-setting/menu-dialog'
import Input from '@/app/components/base/input'

const iconClassName = `
  w-5 h-5 mr-2
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
        icon: <RiBrain2Line className={iconClassName} />,
        activeIcon: <RiBrain2Fill className={iconClassName} />,
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
      name: t('common.settings.generalGroup'),
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

  const [searchValue, setSearchValue] = useState<string>('')

  return (
    <MenuDialog
      show
      onClose={onCancel}
    >
      <div className='mx-auto max-w-[1048px] h-[100vh] flex'>
        <div className='w-[44px] sm:w-[224px] pl-4 pr-6 border-r border-divider-burn flex flex-col'>
          <div className='mt-6 mb-8 px-3 py-2 text-text-primary title-2xl-semi-bold'>{t('common.userProfile.settings')}</div>
          <div className='w-full'>
            {
              menuItems.map(menuItem => (
                <div key={menuItem.key} className='mb-2'>
                  {!isCurrentWorkspaceDatasetOperator && (
                    <div className='py-2 pl-3 pb-1 mb-0.5 system-xs-medium-uppercase text-text-tertiary'>{menuItem.name}</div>
                  )}
                  <div>
                    {
                      menuItem.items.map(item => (
                        <div
                          key={item.key}
                          className={cn(
                            'flex items-center mb-0.5 p-1 pl-3 h-[37px] text-sm cursor-pointer rounded-lg',
                            activeMenu === item.key ? 'bg-state-base-active text-components-menu-item-text-active system-sm-semibold' : 'text-components-menu-item-text system-sm-medium')}
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
        <div className='relative flex w-[824px]'>
          <div className='absolute top-6 -right-11 flex flex-col items-center z-[9999]'>
            <Button
              variant='tertiary'
              size='large'
              className='px-2'
              onClick={onCancel}
            >
              <RiCloseLine className='w-5 h-5' />
            </Button>
            <div className='mt-1 text-text-tertiary system-2xs-medium-uppercase'>ESC</div>
          </div>
          <div ref={scrollRef} className='w-full pb-4 bg-components-panel-bg overflow-y-auto'>
            <div className={cn('sticky top-0 mx-8 pt-[27px] pb-2 mb-[18px] flex items-center bg-components-panel-bg z-20', scrolled && 'border-b border-divider-regular')}>
              <div className='shrink-0 text-text-primary title-2xl-semi-bold'>
                {activeItem?.name}
                {activeItem?.description && (
                  <div className='mt-1 system-sm-regular text-text-tertiary'>{activeItem?.description}</div>
                )}
              </div>
              {activeItem?.key === 'provider' && (
                <div className='grow flex justify-end'>
                  <Input
                    showLeftIcon
                    wrapperClassName='!w-[200px]'
                    className='!h-8 !text-[13px]'
                    onChange={e => setSearchValue(e.target.value)}
                    value={searchValue}
                  />
                </div>
              )}
            </div>
            <div className='px-4 sm:px-8 pt-2'>
              {activeMenu === 'provider' && <ModelProviderPage searchText={searchValue} />}
              {activeMenu === 'members' && <MembersPage />}
              {activeMenu === 'billing' && <BillingPage />}
              {activeMenu === 'data-source' && <DataSourcePage />}
              {activeMenu === 'api-based-extension' && <ApiBasedExtensionPage />}
              {activeMenu === 'custom' && <CustomPage />}
              {activeMenu === 'language' && <LanguagePage />}
            </div>
          </div>
        </div>
      </div>
    </MenuDialog>
  )
}
