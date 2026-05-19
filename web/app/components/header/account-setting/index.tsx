'use client'
import type { AccountSettingTab } from '@/app/components/header/account-setting/constants'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SearchInput from '@/app/components/base/search-input'
import BillingPage from '@/app/components/billing/billing-page'
import CustomPage from '@/app/components/custom/custom-page'
import {
  ACCOUNT_SETTING_TAB,

} from '@/app/components/header/account-setting/constants'
import MenuDialog from '@/app/components/header/account-setting/menu-dialog'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { hasPermission } from '@/utils/permission'
import AccessRulesPage from './access-rules-page'
import { ApiBasedExtensionPage } from './api-based-extension-page'
import DataSourcePage from './data-source-page-new'
import LanguagePage from './language-page'
import MembersPage from './members-page'
import ModelProviderPage from './model-provider-page'
import { useResetModelProviderListExpanded } from './model-provider-page/atoms'
import PermissionsPage from './permissions-page'

const iconClassName = `
  w-5 h-5 mr-2
`

type IAccountSettingProps = {
  onCancelAction: () => void
  activeTab: AccountSettingTab
  onTabChangeAction: (tab: AccountSettingTab) => void
}

type GroupItem = {
  key: AccountSettingTab
  name: string
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
  const activeMenu = activeTab
  const { t } = useTranslation()
  const { enableBilling, enableReplaceWebAppLogo } = useProviderContext()
  const workspacePermissionKeys = useAppContextWithSelector(s => s.workspacePermissionKeys)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const containerRef = useRef<HTMLDivElement>(null)

  const workplaceGroupItems: GroupItem[] = (() => {
    const items: GroupItem[] = [
      {
        key: ACCOUNT_SETTING_TAB.PROVIDER,
        name: t('settings.provider', { ns: 'common' }),
        icon: <span className={cn('i-ri-brain-2-line', iconClassName)} />,
        activeIcon: <span className={cn('i-ri-brain-2-fill', iconClassName)} />,
      },
    ]

    if (hasPermission(workspacePermissionKeys, 'workspace.member.manage')) {
      items.push({
        key: ACCOUNT_SETTING_TAB.MEMBERS,
        name: t('settings.members', { ns: 'common' }),
        icon: <span className={cn('i-ri-group-2-line', iconClassName)} />,
        activeIcon: <span className={cn('i-ri-group-2-fill', iconClassName)} />,
      })
    }

    if (systemFeatures.rbac_enabled && hasPermission(workspacePermissionKeys, 'workspace.role.view')) {
      items.push(
        {
          key: ACCOUNT_SETTING_TAB.PERMISSIONS,
          name: t('settings.permissions', { ns: 'common' }),
          icon: <span className={cn('i-ri-user-settings-line', iconClassName)} />,
          activeIcon: <span className={cn('i-ri-user-settings-fill', iconClassName)} />,
        },
        {
          key: ACCOUNT_SETTING_TAB.ACCESS_RULES,
          name: t('settings.accessRules', { ns: 'common' }),
          icon: <span className={cn('i-ri-shield-user-line', iconClassName)} />,
          activeIcon: <span className={cn('i-ri-shield-user-fill', iconClassName)} />,
        },
      )
    }

    if (enableBilling) {
      items.push({
        key: ACCOUNT_SETTING_TAB.BILLING,
        name: t('settings.billing', { ns: 'common' }),
        description: t('plansCommon.receiptInfo', { ns: 'billing' }),
        icon: <span className={cn('i-ri-money-dollar-circle-line', iconClassName)} />,
        activeIcon: <span className={cn('i-ri-money-dollar-circle-fill', iconClassName)} />,
      })
    }

    if (hasPermission(workspacePermissionKeys, 'data_source.manage')) {
      items.push(
        {
          key: ACCOUNT_SETTING_TAB.DATA_SOURCE,
          name: t('settings.dataSource', { ns: 'common' }),
          icon: <span className={cn('i-ri-database-2-line', iconClassName)} />,
          activeIcon: <span className={cn('i-ri-database-2-fill', iconClassName)} />,
        },
      )
    }

    if (hasPermission(workspacePermissionKeys, 'api_extension.manage')) {
      items.push(
        {
          key: ACCOUNT_SETTING_TAB.API_BASED_EXTENSION,
          name: t('settings.apiBasedExtension', { ns: 'common' }),
          icon: <span className={cn('i-ri-puzzle-2-line', iconClassName)} />,
          activeIcon: <span className={cn('i-ri-puzzle-2-fill', iconClassName)} />,
        },
      )
    }

    if ((enableReplaceWebAppLogo || enableBilling) && hasPermission(workspacePermissionKeys, 'customization.manage')) {
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
  const activeItem = [...menuItems[0]!.items, ...menuItems[1]!.items].find(item => item.key === activeMenu)

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
      <div className="mx-auto flex h-screen max-w-262">
        <div className="flex w-11 flex-col border-r border-divider-burn pr-6 pl-4 sm:w-56">
          <div className="mt-6 mb-8 px-3 py-2 title-2xl-semi-bold text-text-primary">{t('userProfile.settings', { ns: 'common' })}</div>
          <div className="w-full">
            {
              menuItems.map(menuItem => (
                <div key={menuItem.key} className="mb-2">
                  {menuItem.items.length !== 0 && (
                    <div className="mb-0.5 py-2 pb-1 pl-3 system-xs-medium-uppercase text-text-tertiary">{menuItem.name}</div>
                  )}
                  <div>
                    {
                      menuItem.items.map(item => (
                        <button
                          type="button"
                          key={item.key}
                          className={cn(
                            'mb-0.5 flex h-9.25 w-full items-center rounded-lg p-1 pl-3 text-left text-sm',
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
        <div className="relative flex min-h-0 w-206">
          <div className="fixed top-6 right-6 z-9999 flex flex-col items-center">
            <Button
              variant="tertiary"
              size="large"
              className="px-2"
              aria-label={t('operation.close', { ns: 'common' })}
              onClick={handleClose}
            >
              <span className="i-ri-close-line h-5 w-5" />
            </Button>
            <div className="mt-1 system-2xs-medium-uppercase text-text-tertiary">ESC</div>
          </div>
          <ScrollArea
            ref={containerRef}
            className="h-full min-h-0 flex-1 bg-components-panel-bg"
            slotClassNames={{
              viewport: 'overscroll-contain',
              content: 'min-h-full pb-4',
            }}
          >
            <div className="sticky top-0 z-20 mx-8 mb-4.5 flex items-center bg-components-panel-bg pt-6.75 pb-2">
              <div className="shrink-0 title-2xl-semi-bold text-text-primary">
                {activeItem?.name}
                {activeItem?.description && (
                  <div className="mt-1 system-sm-regular text-text-tertiary">{activeItem?.description}</div>
                )}
              </div>
              {activeItem?.key === ACCOUNT_SETTING_TAB.PROVIDER && (
                <div className="flex grow justify-end">
                  <SearchInput
                    className="w-50"
                    onChange={setSearchValue}
                    value={searchValue}
                  />
                </div>
              )}
            </div>
            <div className="px-4 pt-2 sm:px-8">
              {activeMenu === ACCOUNT_SETTING_TAB.PROVIDER && <ModelProviderPage searchText={searchValue} />}
              {activeMenu === ACCOUNT_SETTING_TAB.MEMBERS && <MembersPage />}
              {activeMenu === ACCOUNT_SETTING_TAB.PERMISSIONS && <PermissionsPage containerRef={containerRef} />}
              {activeMenu === ACCOUNT_SETTING_TAB.ACCESS_RULES && <AccessRulesPage />}
              {activeMenu === ACCOUNT_SETTING_TAB.BILLING && <BillingPage />}
              {activeMenu === ACCOUNT_SETTING_TAB.DATA_SOURCE && <DataSourcePage />}
              {activeMenu === ACCOUNT_SETTING_TAB.API_BASED_EXTENSION && <ApiBasedExtensionPage />}
              {activeMenu === ACCOUNT_SETTING_TAB.CUSTOM && <CustomPage />}
              {activeMenu === ACCOUNT_SETTING_TAB.LANGUAGE && <LanguagePage />}
            </div>
          </ScrollArea>
        </div>
      </div>
    </MenuDialog>
  )
}
