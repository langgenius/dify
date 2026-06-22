'use client'
import type { AccountSettingTab } from '@/app/components/header/account-setting/constants'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BillingPage from '@/app/components/billing/billing-page'
import CustomPage from '@/app/components/custom/custom-page'
import {
  ACCOUNT_SETTING_TAB,
} from '@/app/components/header/account-setting/constants'
import MenuDialog from '@/app/components/header/account-setting/menu-dialog'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { BillingPermission, hasPermission } from '@/utils/permission'
import AccessRulesPage from './access-rules-page'
import { ApiBasedExtensionPage } from './api-based-extension-page'
import DataSourcePage from './data-source-page-new'
import LanguagePage from './language-page'
import MembersPage from './members-page'
import ModelProviderPage from './model-provider-page'
import { useResetModelProviderListExpanded } from './model-provider-page/atoms'
import UsageLimitsPage from './usage-limits-page'
import PermissionsPage from './permissions-page'

const iconClassName = `
  w-4 h-4 mr-2
`

type IAccountSettingProps = {
  onCancelAction: () => void
  activeTab: AccountSettingTab
  onTabChangeAction: (tab: AccountSettingTab) => void
}

type GroupItem = {
  key: AccountSettingTab
  name: string
  title?: string
  description?: string
  icon: React.JSX.Element
  activeIcon: React.JSX.Element
}

export default function AccountSetting({
  onCancelAction,
  activeTab,
  onTabChangeAction,
}: IAccountSettingProps) {
  const resetModelProviderListExpanded = useResetModelProviderListExpanded()
  const { t } = useTranslation()
  const { enableBilling, enableReplaceWebAppLogo } = useProviderContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { workspacePermissionKeys } = useAppContext()
  const isRbacEnabled = systemFeatures.rbac_enabled
  const canManageWorkspaceRoles = isRbacEnabled && hasPermission(workspacePermissionKeys, 'workspace.role.manage')
  const canViewBilling = enableBilling && hasPermission(workspacePermissionKeys, BillingPermission.View)
  const activeMenu = (() => {
    if (activeTab === ACCOUNT_SETTING_TAB.BILLING && !canViewBilling)
      return ACCOUNT_SETTING_TAB.LANGUAGE
    if ((activeTab === ACCOUNT_SETTING_TAB.PERMISSIONS || activeTab === ACCOUNT_SETTING_TAB.ACCESS_RULES) && !canManageWorkspaceRoles)
      return ACCOUNT_SETTING_TAB.MEMBERS
    return activeTab
  })()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const settingItems: GroupItem[] = [
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
    {
      key: ACCOUNT_SETTING_TAB.PERMISSIONS,
      name: t('settings.rolesAndPermissions', { ns: 'common' }),
      icon: <span className={cn('i-ri-shield-user-line', iconClassName)} />,
      activeIcon: <span className={cn('i-ri-shield-user-fill', iconClassName)} />,
    },
    {
      key: ACCOUNT_SETTING_TAB.ACCESS_RULES,
      name: t('settings.resourceAccess', { ns: 'common' }),
      description: t('settings.resourceAccessDescription', { ns: 'common' }),
      icon: <span className={cn('i-ri-lock-2-line', iconClassName)} />,
      activeIcon: <span className={cn('i-ri-lock-2-fill', iconClassName)} />,
    },
    {
      key: ACCOUNT_SETTING_TAB.BILLING,
      name: t('settings.billing', { ns: 'common' }),
      description: t('plansCommon.receiptInfo', { ns: 'billing' }),
      icon: <span className={cn('i-ri-money-dollar-circle-line', iconClassName)} />,
      activeIcon: <span className={cn('i-ri-money-dollar-circle-fill', iconClassName)} />,
    },
    {
      key: ACCOUNT_SETTING_TAB.DATA_SOURCE,
      name: t('settings.dataSource', { ns: 'common' }),
      icon: <span className={cn('i-ri-database-2-line', iconClassName)} />,
      activeIcon: <span className={cn('i-ri-database-2-fill', iconClassName)} />,
    },
    {
      key: ACCOUNT_SETTING_TAB.API_BASED_EXTENSION,
      name: t('settings.customEndpoint', { ns: 'common' }),
      icon: <span className={cn('i-ri-puzzle-2-line', iconClassName)} />,
      activeIcon: <span className={cn('i-ri-puzzle-2-fill', iconClassName)} />,
    },
    {
      key: ACCOUNT_SETTING_TAB.CUSTOM,
      name: t('custom', { ns: 'custom' }),
      icon: <span className={cn('i-ri-color-filter-line', iconClassName)} />,
      activeIcon: <span className={cn('i-ri-color-filter-fill', iconClassName)} />,
    },
    {
      key: ACCOUNT_SETTING_TAB.LANGUAGE,
      name: t('settings.preferences', { ns: 'common' }),
      title: t('account.general', { ns: 'common' }),
      icon: <span className={cn('i-ri-equalizer-2-line', iconClassName)} />,
      activeIcon: <span className={cn('i-ri-equalizer-2-fill', iconClassName)} />,
    },
  ]
  const activeItem = settingItems.find(item => item.key === activeMenu)

  const visibleSettingItems: GroupItem[] = (() => {
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
      {
        key: ACCOUNT_SETTING_TAB.USAGE_LIMITS,
        name: t('settings.usageLimits', { ns: 'common' }),
        icon: <span className={cn('i-ri-speed-line', iconClassName)} />,
        activeIcon: <span className={cn('i-ri-speed-fill', iconClassName)} />,
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
    const visibleTabs: AccountSettingTab[] = []

    visibleTabs.push(ACCOUNT_SETTING_TAB.MEMBERS)

    if (canManageWorkspaceRoles) {
      visibleTabs.push(ACCOUNT_SETTING_TAB.PERMISSIONS)
      visibleTabs.push(ACCOUNT_SETTING_TAB.ACCESS_RULES)
    }

    if (canViewBilling)
      visibleTabs.push(ACCOUNT_SETTING_TAB.BILLING)

    if (enableReplaceWebAppLogo || enableBilling)
      visibleTabs.push(ACCOUNT_SETTING_TAB.CUSTOM)

    return visibleTabs
      .map(tab => settingItems.find(item => item.key === tab))
      .filter((item): item is GroupItem => Boolean(item))
  })()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const languageItem = settingItems.find(item => item.key === ACCOUNT_SETTING_TAB.LANGUAGE)

  const menuItems = [
    {
      key: 'workspace-group',
      name: t('settings.workspace', { ns: 'common' }),
      items: visibleSettingItems,
    },
    {
      key: 'user-group',
      items: languageItem ? [languageItem] : [],
    },
  ]

  const [searchValue, setSearchValue] = useState<string>('')

  const handleTabChange = useCallback((tab: AccountSettingTab) => {
    if (tab === ACCOUNT_SETTING_TAB.PROVIDER)
      resetModelProviderListExpanded()

    onTabChangeAction(tab)
  }, [onTabChangeAction, resetModelProviderListExpanded])

  const handleClose = useCallback(() => {
    resetModelProviderListExpanded()
    onCancelAction()
  }, [onCancelAction, resetModelProviderListExpanded])

  return (
    <MenuDialog
      show
      onClose={handleClose}
    >
      <div className="flex h-screen w-full max-w-full pl-0 sm:pl-[232px]">
        <div className="flex w-[44px] shrink-0 flex-col pr-6 pl-4 sm:w-[224px]">
          <div className="mt-6 mb-8 flex h-[38px] items-center px-3 title-2xl-semi-bold whitespace-nowrap text-text-primary">{t('settings.settings', { ns: 'common' })}</div>
          <div className="w-full">
            {
              menuItems.map(menuItem => (
                <div key={menuItem.key} className={cn(menuItem.key === 'workspace-group' ? 'mb-2' : 'mt-2')}>
                  {menuItem.name && !isMobile && (
                    <div className="flex h-7 items-center px-3 system-xs-medium-uppercase text-text-tertiary">
                      {menuItem.name}
                    </div>
                  )}
                  <div className={cn(menuItem.key === 'user-group' && 'border-t border-divider-subtle pt-3')}>
                    {
                      menuItem.items.map(item => (
                        <button
                          type="button"
                          key={item.key}
                          className={cn(
                            'mb-0.5 flex h-8 w-full items-center rounded-lg px-3 text-left text-sm',
                            activeMenu === item.key ? 'bg-state-base-active system-sm-semibold text-components-menu-item-text-active' : 'system-sm-medium text-components-menu-item-text',
                          )}
                          aria-label={item.name}
                          title={item.name}
                          onClick={() => {
                            handleTabChange(item.key)
                          }}
                        >
                          {activeMenu === item.key ? item.activeIcon : item.icon}
                          {!isMobile && <div className="truncate">{item.name}</div>}
                        </button>
                      ))
                    }
                  </div>
                </div>
              ))
            }
          </div>
        </div>
        <div className="relative flex min-h-0 w-[824px]">
          <div className="fixed top-6 right-6 z-9999 flex flex-col items-center">
            <Button
              variant="tertiary"
              size="large"
              className="px-2"
              aria-label={t('operation.close', { ns: 'common' })}
              onClick={handleClose}
            >
              <span className="i-ri-close-line size-5" />
            </Button>
            <div className="mt-1 system-2xs-medium-uppercase text-text-tertiary">ESC</div>
          </div>
          <ScrollArea
            ref={scrollContainerRef}
            className="h-full min-h-0 flex-1 bg-components-panel-bg"
            slotClassNames={{
              viewport: 'overscroll-contain',
              content: 'min-h-full pb-4',
            }}
          >
            <div className="sticky top-0 z-20 mx-8 flex min-h-[60px] items-end bg-components-panel-bg pt-8 pb-2">
              <div className="min-w-0 flex-1 title-2xl-semi-bold text-text-primary">
                {activeItem?.title ?? activeItem?.name}
                {activeItem?.description && (
                  <div className="mt-1 system-sm-regular wrap-break-word whitespace-normal text-text-tertiary">{activeItem?.description}</div>
                )}
              </div>
            </div>
            <div className="px-4 pt-6 sm:px-8">
              {activeMenu === ACCOUNT_SETTING_TAB.PROVIDER && (
                <ModelProviderPage
                  searchText={searchValue}
                  onSearchTextChange={setSearchValue}
                />
              )}
              {activeMenu === ACCOUNT_SETTING_TAB.MEMBERS && <MembersPage />}
              {activeMenu === ACCOUNT_SETTING_TAB.PERMISSIONS && <PermissionsPage containerRef={scrollContainerRef} />}
              {activeMenu === ACCOUNT_SETTING_TAB.ACCESS_RULES && <AccessRulesPage />}
              {activeMenu === ACCOUNT_SETTING_TAB.BILLING && <BillingPage />}
              {activeMenu === ACCOUNT_SETTING_TAB.DATA_SOURCE && <DataSourcePage />}
              {activeMenu === ACCOUNT_SETTING_TAB.API_BASED_EXTENSION && <ApiBasedExtensionPage />}
              {activeMenu === ACCOUNT_SETTING_TAB.USAGE_LIMITS && <UsageLimitsPage />}
              {activeMenu === ACCOUNT_SETTING_TAB.CUSTOM && <CustomPage />}
              {activeMenu === ACCOUNT_SETTING_TAB.LANGUAGE && <LanguagePage />}
            </div>
          </ScrollArea>
        </div>
      </div>
    </MenuDialog>
  )
}
