'use client'
import type { AccountSettingTab } from '@/app/components/header/account-setting/constants'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import BillingPage from '@/app/components/billing/billing-page'
import CustomPage from '@/app/components/custom/custom-page'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import MenuDialog from '@/app/components/header/account-setting/menu-dialog'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useProviderContext } from '@/context/provider-context'
import {
  isCurrentWorkspaceDatasetOperatorAtom,
  isCurrentWorkspaceManagerAtom,
} from '@/context/workspace-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { hasPermission } from '@/utils/permission'
import AccessRulesPage from './access-rules-page'
import MembersPage from './members-page'
import PermissionsPage from './permissions-page'
import PreferencePage from './preference-page'
import WorkflowLogArchivesPage from './workflow-log-archives-page'

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
  const { t } = useTranslation()
  const { enableBilling, enableReplaceWebAppLogo } = useProviderContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const isCurrentWorkspaceManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const isCurrentWorkspaceDatasetOperator = useAtomValue(isCurrentWorkspaceDatasetOperatorAtom)
  const isRbacEnabled = systemFeatures.rbac_enabled
  const canManageWorkspaceRoles =
    isRbacEnabled && hasPermission(workspacePermissionKeys, 'workspace.role.manage')
  const canViewBilling = enableBilling && !isCurrentWorkspaceDatasetOperator
  const canViewWorkflowLogArchives =
    systemFeatures.deployment_edition === 'CLOUD' && isCurrentWorkspaceManager
  const activeMenu = (() => {
    if (activeTab === ACCOUNT_SETTING_TAB.BILLING && !canViewBilling)
      return ACCOUNT_SETTING_TAB.PREFERENCES
    if (activeTab === ACCOUNT_SETTING_TAB.WORKFLOW_LOG_ARCHIVES && !canViewWorkflowLogArchives)
      return ACCOUNT_SETTING_TAB.MEMBERS
    if (
      (activeTab === ACCOUNT_SETTING_TAB.ROLES_AND_PERMISSIONS ||
        activeTab === ACCOUNT_SETTING_TAB.PERMISSION_SET) &&
      !canManageWorkspaceRoles
    )
      return ACCOUNT_SETTING_TAB.MEMBERS
    return activeTab
  })()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const settingItems: GroupItem[] = [
    {
      key: ACCOUNT_SETTING_TAB.MEMBERS,
      name: t(($) => $['settings.members'], { ns: 'common' }),
      icon: <span className={cn('i-ri-group-2-line', iconClassName)} />,
      activeIcon: <span className={cn('i-ri-group-2-fill', iconClassName)} />,
    },
    {
      key: ACCOUNT_SETTING_TAB.ROLES_AND_PERMISSIONS,
      name: t(($) => $['settings.rolesAndPermissions'], { ns: 'common' }),
      icon: <span className={cn('i-ri-shield-user-line', iconClassName)} />,
      activeIcon: <span className={cn('i-ri-shield-user-fill', iconClassName)} />,
    },
    {
      key: ACCOUNT_SETTING_TAB.PERMISSION_SET,
      name: t(($) => $['settings.permissionSet'], { ns: 'common' }),
      description: t(($) => $['settings.permissionSetDescription'], { ns: 'common' }),
      icon: <span className={cn('i-ri-lock-2-line', iconClassName)} />,
      activeIcon: <span className={cn('i-ri-lock-2-fill', iconClassName)} />,
    },
    {
      key: ACCOUNT_SETTING_TAB.BILLING,
      name: t(($) => $['settings.billing'], { ns: 'common' }),
      description: t(($) => $['plansCommon.receiptInfo'], { ns: 'billing' }),
      icon: <span className={cn('i-ri-money-dollar-circle-line', iconClassName)} />,
      activeIcon: <span className={cn('i-ri-money-dollar-circle-fill', iconClassName)} />,
    },
    {
      key: ACCOUNT_SETTING_TAB.WORKFLOW_LOG_ARCHIVES,
      name: t(($) => $['archives.title'], { ns: 'appLog' }),
      description: t(($) => $['archives.description'], { ns: 'appLog' }),
      icon: <span className={cn('i-ri-archive-drawer-line', iconClassName)} />,
      activeIcon: <span className={cn('i-ri-archive-drawer-fill', iconClassName)} />,
    },
    {
      key: ACCOUNT_SETTING_TAB.CUSTOM,
      name: t(($) => $.custom, { ns: 'custom' }),
      icon: <span className={cn('i-ri-color-filter-line', iconClassName)} />,
      activeIcon: <span className={cn('i-ri-color-filter-fill', iconClassName)} />,
    },
    {
      key: ACCOUNT_SETTING_TAB.PREFERENCES,
      name: t(($) => $['settings.preferences'], { ns: 'common' }),
      title: t(($) => $['account.general'], { ns: 'common' }),
      icon: <span className={cn('i-ri-equalizer-2-line', iconClassName)} />,
      activeIcon: <span className={cn('i-ri-equalizer-2-fill', iconClassName)} />,
    },
  ]
  const activeItem = settingItems.find((item) => item.key === activeMenu)

  const visibleSettingItems: GroupItem[] = (() => {
    const visibleTabs: AccountSettingTab[] = []

    visibleTabs.push(ACCOUNT_SETTING_TAB.MEMBERS)

    if (canManageWorkspaceRoles) {
      visibleTabs.push(ACCOUNT_SETTING_TAB.ROLES_AND_PERMISSIONS)
      visibleTabs.push(ACCOUNT_SETTING_TAB.PERMISSION_SET)
    }

    if (canViewBilling) visibleTabs.push(ACCOUNT_SETTING_TAB.BILLING)

    if (enableReplaceWebAppLogo || enableBilling) visibleTabs.push(ACCOUNT_SETTING_TAB.CUSTOM)

    if (canViewWorkflowLogArchives) visibleTabs.push(ACCOUNT_SETTING_TAB.WORKFLOW_LOG_ARCHIVES)

    return visibleTabs
      .map((tab) => settingItems.find((item) => item.key === tab))
      .filter((item): item is GroupItem => Boolean(item))
  })()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const preferenceItem = settingItems.find((item) => item.key === ACCOUNT_SETTING_TAB.PREFERENCES)

  const menuItems = [
    {
      key: 'workspace-group',
      name: t(($) => $['settings.workspace'], { ns: 'common' }),
      items: visibleSettingItems,
    },
    {
      key: 'user-group',
      items: preferenceItem ? [preferenceItem] : [],
    },
  ]

  return (
    <MenuDialog title={t(($) => $['settings.settings'], { ns: 'common' })} onClose={onCancelAction}>
      <div className="flex h-screen w-full max-w-full pl-0 sm:pl-58">
        <div className="flex w-11 shrink-0 flex-col pr-6 pl-4 sm:w-56">
          <div className="mt-6 mb-8 flex h-9.5 items-center px-3 title-2xl-semi-bold whitespace-nowrap text-text-primary">
            {t(($) => $['settings.settings'], { ns: 'common' })}
          </div>
          <div className="w-full">
            {menuItems.map((menuItem) => (
              <div
                key={menuItem.key}
                className={cn(menuItem.key === 'workspace-group' ? 'mb-2' : 'mt-2')}
              >
                {menuItem.name && !isMobile && (
                  <div className="flex h-7 items-center px-3 system-xs-medium-uppercase text-text-tertiary">
                    {menuItem.name}
                  </div>
                )}
                <div
                  className={cn(
                    menuItem.key === 'user-group' && 'border-t border-divider-subtle pt-3',
                  )}
                >
                  {menuItem.items.map((item) => (
                    <button
                      type="button"
                      key={item.key}
                      className={cn(
                        'mb-0.5 flex h-8 w-full items-center rounded-lg px-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
                        activeMenu === item.key
                          ? 'bg-state-base-active system-sm-semibold text-components-menu-item-text-active'
                          : 'system-sm-medium text-components-menu-item-text',
                      )}
                      aria-label={item.name}
                      title={item.name}
                      onClick={() => {
                        onTabChangeAction(item.key)
                      }}
                    >
                      {activeMenu === item.key ? item.activeIcon : item.icon}
                      {!isMobile && <div className="truncate">{item.name}</div>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative flex min-h-0 w-206 min-w-0">
          <ScrollArea className="h-full min-h-0 min-w-0 flex-1 bg-components-panel-bg">
            <ScrollAreaViewport
              ref={scrollContainerRef}
              style={{ overflowX: 'hidden' }}
              className="overscroll-contain"
            >
              <ScrollAreaContent
                style={{ minWidth: 0 }}
                className="min-h-full w-full max-w-full pb-4"
              >
                <div className="sticky top-0 z-20 mx-8 flex min-h-15 items-end bg-components-panel-bg pt-8 pb-2">
                  <div className="min-w-0 flex-1 title-2xl-semi-bold text-text-primary">
                    {activeItem?.title ?? activeItem?.name}
                    {activeItem?.description && (
                      <div className="mt-1 system-sm-regular wrap-break-word whitespace-normal text-text-tertiary">
                        {activeItem?.description}
                      </div>
                    )}
                  </div>
                </div>
                <div className="max-w-full min-w-0 px-4 pt-6 sm:px-8">
                  {activeMenu === ACCOUNT_SETTING_TAB.MEMBERS && <MembersPage />}
                  {activeMenu === ACCOUNT_SETTING_TAB.ROLES_AND_PERMISSIONS && (
                    <PermissionsPage containerRef={scrollContainerRef} />
                  )}
                  {activeMenu === ACCOUNT_SETTING_TAB.PERMISSION_SET && <AccessRulesPage />}
                  {activeMenu === ACCOUNT_SETTING_TAB.BILLING && <BillingPage />}
                  {activeMenu === ACCOUNT_SETTING_TAB.WORKFLOW_LOG_ARCHIVES && (
                    <WorkflowLogArchivesPage />
                  )}
                  {activeMenu === ACCOUNT_SETTING_TAB.CUSTOM && <CustomPage />}
                  {activeMenu === ACCOUNT_SETTING_TAB.PREFERENCES && <PreferencePage />}
                </div>
              </ScrollAreaContent>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar>
              <ScrollAreaThumb />
            </ScrollAreaScrollbar>
          </ScrollArea>
        </div>
      </div>
    </MenuDialog>
  )
}
