'use client'
import type { AccountSettingTab } from '@/app/components/header/account-setting/constants'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SearchInput from '@/app/components/base/search-input'
import BillingPage from '@/app/components/billing/billing-page'
import CustomPage from '@/app/components/custom/custom-page'
import {
  ACCOUNT_SETTING_TAB,

} from '@/app/components/header/account-setting/constants'
import MenuDialog from '@/app/components/header/account-setting/menu-dialog'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { cn } from '@/utils/classnames'
import Button from '../../base/button'
import ApiBasedExtensionPage from './api-based-extension-page'
import DataSourcePage from './data-source-page-new'
import LanguagePage from './language-page'
import MembersPage from './members-page'
import ModelProviderPage from './model-provider-page'

const iconClassName = `
  w-5 h-5 mr-2
`

type IAccountSettingProps = {
  onCancel: () => void
  activeTab?: AccountSettingTab
  onTabChange?: (tab: AccountSettingTab) => void
}

type GroupItem = {
  key: AccountSettingTab
  name: string
  description?: string
  icon: React.JSX.Element
  activeIcon: React.JSX.Element
}

export default function AccountSetting({
  onCancel,
  activeTab = ACCOUNT_SETTING_TAB.MEMBERS,
  onTabChange,
}: IAccountSettingProps) {
  const [activeMenu, setActiveMenu] = useState<AccountSettingTab>(activeTab)
  useEffect(() => {
    setActiveMenu(activeTab)
  }, [activeTab])
  const { t } = useTranslation()
  const { enableBilling, enableReplaceWebAppLogo } = useProviderContext()
  const { isCurrentWorkspaceDatasetOperator } = useAppContext()

  const workplaceGroupItems: GroupItem[] = (() => {
    if (isCurrentWorkspaceDatasetOperator)
      return []

    const items: GroupItem[] = [
      {
        key: ACCOUNT_SETTING_TAB.PROVIDER,
        name: t('settings.provider', { ns: 'common' }),
        icon: <span className={cn('i-ri-brain-2-line', iconClassName)} />,
        activeIcon: <span className={cn('i-ri-brain-2-fill', iconClassName)} />,
      },
      {
        key: ACCOUNT_SETTING_TAB.MEMBERS,
        name: t('settings.members', { ns: 'common' }),
        icon: <span className={cn('i-ri-group-2-line', iconClassName)} />,
        activeIcon: <span className={cn('i-ri-group-2-fill', iconClassName)} />,
      },
    ]

    if (enableBilling) {
      items.push({
        key: ACCOUNT_SETTING_TAB.BILLING,
        name: t('settings.billing', { ns: 'common' }),
        description: t('plansCommon.receiptInfo', { ns: 'billing' }),
        icon: <span className={cn('i-ri-money-dollar-circle-line', iconClassName)} />,
        activeIcon: <span className={cn('i-ri-money-dollar-circle-fill', iconClassName)} />,
      })
    }

    items.push(
      {
        key: ACCOUNT_SETTING_TAB.DATA_SOURCE,
        name: t('settings.dataSource', { ns: 'common' }),
        icon: <span className={cn('i-ri-database-2-line', iconClassName)} />,
        activeIcon: <span className={cn('i-ri-database-2-fill', iconClassName)} />,
      },
      {
        key: ACCOUNT_SETTING_TAB.API_BASED_EXTENSION,
        name: t('settings.apiBasedExtension', { ns: 'common' }),
        icon: <span className={cn('i-ri-puzzle-2-line', iconClassName)} />,
        activeIcon: <span className={cn('i-ri-puzzle-2-fill', iconClassName)} />,
      },
    )

    if (enableReplaceWebAppLogo || enableBilling) {
      items.push({
        key: ACCOUNT_SETTING_TAB.CUSTOM,
        name: t('custom', { ns: 'custom' }),
        icon: <span className={cn('i-ri-color-filter-line', iconClassName)} />,
        activeIcon: <span className={cn('i-ri-color-filter-fill', iconClassName)} />,
      })
    }

    return items
  })()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const menuItems = [
    {
      key: 'workspace-group',
      name: t('settings.workplaceGroup', { ns: 'common' }),
      items: workplaceGroupItems,
    },
    {
      key: 'account-group',
      name: t('settings.generalGroup', { ns: 'common' }),
      items: [
        {
          key: ACCOUNT_SETTING_TAB.LANGUAGE,
          name: t('settings.language', { ns: 'common' }),
          icon: <span className={cn('i-ri-translate-2', iconClassName)} />,
          activeIcon: <span className={cn('i-ri-translate-2', iconClassName)} />,
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
      <div className="mx-auto flex h-[100vh] max-w-[1048px]">
        <div className="flex w-[44px] flex-col border-r border-divider-burn pl-4 pr-6 sm:w-[224px]">
          <div className="mb-8 mt-6 px-3 py-2 text-text-primary title-2xl-semi-bold">{t('userProfile.settings', { ns: 'common' })}</div>
          <div className="w-full">
            {
              menuItems.map(menuItem => (
                <div key={menuItem.key} className="mb-2">
                  {!isCurrentWorkspaceDatasetOperator && (
                    <div className="mb-0.5 py-2 pb-1 pl-3 text-text-tertiary system-xs-medium-uppercase">{menuItem.name}</div>
                  )}
                  <div>
                    {
                      menuItem.items.map(item => (
                        <div
                          key={item.key}
                          className={cn(
                            'mb-0.5 flex h-[37px] cursor-pointer items-center rounded-lg p-1 pl-3 text-sm',
                            activeMenu === item.key ? 'bg-state-base-active text-components-menu-item-text-active system-sm-semibold' : 'text-components-menu-item-text system-sm-medium',
                          )}
                          title={item.name}
                          onClick={() => {
                            setActiveMenu(item.key)
                            onTabChange?.(item.key)
                          }}
                        >
                          {activeMenu === item.key ? item.activeIcon : item.icon}
                          {!isMobile && <div className="truncate">{item.name}</div>}
                        </div>
                      ))
                    }
                  </div>
                </div>
              ))
            }
          </div>
        </div>
        <div className="relative flex w-[824px]">
          <div className="fixed right-6 top-6 z-[9999] flex flex-col items-center">
            <Button
              variant="tertiary"
              size="large"
              className="px-2"
              onClick={onCancel}
            >
              <span className="i-ri-close-line h-5 w-5" />
            </Button>
            <div className="mt-1 text-text-tertiary system-2xs-medium-uppercase">ESC</div>
          </div>
          <div ref={scrollRef} className="w-full overflow-y-auto bg-components-panel-bg pb-4">
            <div className={cn('sticky top-0 z-20 mx-8 mb-[18px] flex items-center bg-components-panel-bg pb-2 pt-[27px]', scrolled && 'border-b border-divider-regular')}>
              <div className="shrink-0 text-text-primary title-2xl-semi-bold">
                {activeItem?.name}
                {activeItem?.description && (
                  <div className="mt-1 text-text-tertiary system-sm-regular">{activeItem?.description}</div>
                )}
              </div>
              {activeItem?.key === 'provider' && (
                <div className="flex grow justify-end">
                  <SearchInput
                    className="w-[200px]"
                    onChange={setSearchValue}
                    value={searchValue}
                  />
                </div>
              )}
            </div>
            <div className="px-4 pt-2 sm:px-8">
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
