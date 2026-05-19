'use client'

import type { CSSProperties } from 'react'
import type { IntegrationSection } from '@/app/components/tools/integration-routes'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import UpdateSettingPopover from '@/app/components/header/account-setting/update-setting-popover'
import DebugInfo from '@/app/components/plugins/plugin-page/debug-info'
import InstallPluginDropdown from '@/app/components/plugins/plugin-page/install-plugin-dropdown'
import {
  buildIntegrationPath,
  buildMarketplacePathByIntegrationSection,
  toolCategoryBySection,
} from '@/app/components/tools/integration-routes'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { toolsContentInsetClassNames, toolsUnifiedContentFrameClassName } from './content-inset'
import { getPluginCategoryBySection, useIntegrationNav } from './hooks/use-integration-nav'
import { useIntegrationPermissions } from './hooks/use-integration-permissions'
import { useIntegrationSection } from './hooks/use-integration-section'
import { IntegrationPageHeader } from './integration-page-header'
import IntegrationSectionRenderer from './integration-section-renderer'
import {
  IntegrationSidebarNavItem,
} from './integration-sidebar-nav-item'
import {
  integrationSidebarActiveNavItemClassName,
  integrationSidebarInactiveNavItemClassName,
  integrationSidebarNavItemClassName,
} from './integration-sidebar-nav-item-styles'
import { PermissionQuickPanel } from './permission-quick-panel'

const buildSectionHref = (section: IntegrationSection) => {
  return buildIntegrationPath(section)
}

type IntegrationsPageProps = {
  onSectionChange?: (section: IntegrationSection) => void
  onSwitchToMarketplace?: (path: string) => void
  section?: IntegrationSection
}

export default function IntegrationsPage({
  onSectionChange,
  onSwitchToMarketplace,
  section: routeSection,
}: IntegrationsPageProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const section = useIntegrationSection(routeSection)
  const {
    canManagement,
    canDebugger,
    handlePermissionChange,
    isPluginCategory,
    permission,
    showPermissionQuickPanel,
    showPluginCategorySetting,
  } = useIntegrationPermissions(section)
  const [providerSearchText, setProviderSearchText] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const {
    activeItem,
    dataSourceItem,
    integrationHeader,
    providerItem,
    secondaryItems,
    toolItems,
  } = useIntegrationNav(section)
  const isToolSection = Boolean(toolCategoryBySection[section])
  const useFillLayout = isToolSection || isPluginCategory
  const headerFrameClassName = cn(
    toolsContentInsetClassNames.compact,
    toolsUnifiedContentFrameClassName,
  )
  const sidebarWidthStyle = {
    '--integrations-sidebar-width': sidebarCollapsed ? '56px' : '200px',
    '--model-provider-warning-left': `calc(240px + ${sidebarCollapsed ? '56px' : '200px'})`,
  } as CSSProperties & Record<'--integrations-sidebar-width' | '--model-provider-warning-left', string>
  const pluginSettingCategory = getPluginCategoryBySection(section)
  const pluginSettingAction = showPluginCategorySetting && pluginSettingCategory
    ? (
        <UpdateSettingPopover
          category={pluginSettingCategory}
        />
      )
    : undefined
  const marketplacePath = buildMarketplacePathByIntegrationSection(section)
  const handleSwitchToMarketplace = () => {
    if (onSwitchToMarketplace) {
      onSwitchToMarketplace(marketplacePath)
      return
    }

    router.push(marketplacePath)
  }
  const toolsNavItemClassName = cn(
    integrationSidebarNavItemClassName,
    sidebarCollapsed && 'justify-center px-0',
    section === 'builtin' ? integrationSidebarActiveNavItemClassName : integrationSidebarInactiveNavItemClassName,
  )
  const toolsNavItemContent = (
    <>
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
        <span className={cn(
          'h-3.5 w-[12.5px]',
          section === 'builtin' ? 'i-custom-vender-integrations-tools-active' : 'i-custom-vender-integrations-tools',
        )}
        />
      </span>
      {!sidebarCollapsed && (
        <span className="min-w-0 flex-1 truncate">{t('menus.tools', { ns: 'common' })}</span>
      )}
    </>
  )

  return (
    <div className="flex h-full min-h-0 bg-components-panel-bg" style={sidebarWidthStyle}>
      <aside className={cn(
        'flex shrink-0 flex-col border-r border-divider-burn bg-components-panel-bg px-2 py-2 transition-[width]',
        sidebarCollapsed ? 'w-14 items-center' : 'w-[200px] items-end',
      )}
      >
        <div className={cn(
          'flex min-h-0 flex-1 flex-col pb-4',
          sidebarCollapsed ? 'w-10' : 'w-[184px]',
        )}
        >
          <div className={cn(
            'flex h-8 shrink-0 items-center py-1',
            sidebarCollapsed ? 'justify-center' : 'justify-between',
          )}
          >
            {!sidebarCollapsed && (
              <div className="title-3xl-semi-bold whitespace-nowrap text-text-primary">
                {t('settings.integrations', { ns: 'common' })}
              </div>
            )}
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
              aria-label={t(sidebarCollapsed ? 'settings.expand' : 'settings.collapse', { ns: 'common' })}
              title={t(sidebarCollapsed ? 'settings.expand' : 'settings.collapse', { ns: 'common' })}
              onClick={() => setSidebarCollapsed(collapsed => !collapsed)}
            >
              <span
                aria-hidden
                className={cn(
                  'i-custom-vender-integrations-panel-left size-[14.5px]',
                  sidebarCollapsed && 'rotate-180',
                )}
              />
            </button>
          </div>
          {!sidebarCollapsed && (
            <div className="mt-6 flex shrink-0 items-center gap-1">
              <InstallPluginDropdown
                disabled={!canManagement}
                rootClassName="min-w-0 flex-1"
                triggerVariant="primary"
                triggerClassName="h-8 min-w-0 gap-0.5 p-2 system-sm-medium"
                triggerLabel={t('installAction', { ns: 'plugin' })}
                triggerOpenClassName="bg-components-button-primary-bg-hover"
                popupClassName="w-[240px] rounded-2xl py-2 shadow-xl"
                installContextCategory={getPluginCategoryBySection(section)}
                onSwitchToMarketplaceTab={handleSwitchToMarketplace}
              />
              <div className="size-8 shrink-0">
                {canDebugger
                  ? (
                      <DebugInfo />
                    )
                  : (
                      <Button
                        variant="secondary"
                        disabled
                        className="h-full w-full p-0"
                        aria-label={t('debugInfo.title', { ns: 'plugin' })}
                        title={t('debugInfo.title', { ns: 'plugin' })}
                      >
                        <span aria-hidden className="i-ri-bug-line size-4" />
                      </Button>
                    )}
              </div>
              <Popover>
                <PopoverTrigger
                  render={(
                    <Button
                      variant="secondary"
                      disabled={!showPermissionQuickPanel}
                      className="size-8 shrink-0 p-0"
                      aria-label={t('privilege.permissions', { ns: 'plugin' })}
                      title={t('privilege.permissions', { ns: 'plugin' })}
                    >
                      <span aria-hidden className="i-ri-equalizer-2-line size-4" />
                    </Button>
                  )}
                />
                {showPermissionQuickPanel && permission && (
                  <PopoverContent
                    placement="bottom-start"
                    sideOffset={4}
                    popupClassName="border-0 bg-transparent p-0 shadow-none"
                  >
                    <PermissionQuickPanel
                      permission={permission}
                      onChange={handlePermissionChange}
                    />
                  </PopoverContent>
                )}
              </Popover>
            </div>
          )}
          <nav className="mt-6 shrink-0 space-y-0.5">
            <IntegrationSidebarNavItem collapsed={sidebarCollapsed} item={providerItem} onSelect={onSectionChange} section={section} />
            <IntegrationSidebarNavItem collapsed={sidebarCollapsed} item={dataSourceItem} onSelect={onSectionChange} section={section} />
            <div>
              {onSectionChange
                ? (
                    <button
                      type="button"
                      title={t('menus.tools', { ns: 'common' })}
                      aria-label={t('menus.tools', { ns: 'common' })}
                      className={cn(toolsNavItemClassName, 'border-none bg-transparent')}
                      onClick={() => onSectionChange('builtin')}
                    >
                      {toolsNavItemContent}
                    </button>
                  )
                : (
                    <Link
                      href={buildSectionHref('builtin')}
                      title={t('menus.tools', { ns: 'common' })}
                      aria-label={t('menus.tools', { ns: 'common' })}
                      className={toolsNavItemClassName}
                    >
                      {toolsNavItemContent}
                    </Link>
                  )}
              <div className={cn('space-y-0.5', !sidebarCollapsed && 'pl-6')}>
                {toolItems.map(item => (
                  <IntegrationSidebarNavItem
                    collapsed={sidebarCollapsed}
                    key={item.label}
                    item={item}
                    onSelect={onSectionChange}
                    section={section}
                  />
                ))}
              </div>
            </div>
            {secondaryItems.map(item => (
              <IntegrationSidebarNavItem
                collapsed={sidebarCollapsed}
                key={item.label}
                item={item}
                onSelect={onSectionChange}
                section={section}
              />
            ))}
          </nav>
        </div>
        {!sidebarCollapsed && (
          <div className="flex min-h-[123px] w-full shrink-0 flex-col items-start gap-2 rounded-xl bg-background-default-hover p-4">
            <div className="relative isolate h-[34.654px] w-[86.251px] shrink-0">
              <div className="absolute top-0 left-[-1px] z-[3] flex size-[34.139px] items-center justify-center">
                <div className="flex size-8 rotate-[-3.97deg] items-center justify-center rounded-lg border border-background-default-subtle bg-background-default-subtle">
                  <div className="flex size-full items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-components-icon-bg-pink-soft p-1 text-[20px] leading-[1.2]">
                    🕹️
                  </div>
                </div>
              </div>
              <div className="absolute top-0 left-[26.14px] z-[2] flex size-[34.654px] items-center justify-center">
                <div className="flex size-8 rotate-[4.97deg] items-center justify-center rounded-lg border border-background-default-subtle bg-background-default-subtle">
                  <div className="flex size-full items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-components-icon-bg-orange-dark-soft p-1 text-[20px] leading-[1.2]">
                    📙
                  </div>
                </div>
              </div>
              <div className="absolute top-px left-[53.79px] z-[1] flex size-[33.458px] items-center justify-center">
                <div className="flex size-8 rotate-[-2.67deg] items-center justify-center rounded-lg border border-background-default-subtle bg-background-default-subtle">
                  <div className="flex size-full items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-components-icon-bg-teal-soft p-1 text-[20px] leading-[1.2]">
                    🤖
                  </div>
                </div>
              </div>
            </div>
            <div className="w-full system-xs-medium text-text-secondary">
              {t('settings.discoverMoreIntegrationsInMarketplace', { ns: 'common' })}
            </div>
          </div>
        )}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {integrationHeader && (
          <IntegrationPageHeader
            title={integrationHeader.title}
            description={integrationHeader.description}
            frameClassName={headerFrameClassName}
          />
        )}
        {!integrationHeader && !isToolSection && (
          <IntegrationPageHeader
            align="center"
            title={activeItem?.label}
            description={section === 'provider' ? t('modelProvider.pageDesc', { ns: 'common' }) : undefined}
            descriptionClassName="mt-0.5 system-xs-regular"
            frameClassName={headerFrameClassName}
          />
        )}
        <div className={cn(
          'min-h-0 flex-1',
          useFillLayout ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
        )}
        >
          <IntegrationSectionRenderer
            key={section}
            section={section}
            providerSearchText={providerSearchText}
            onProviderSearchTextChange={setProviderSearchText}
            onSwitchToMarketplace={handleSwitchToMarketplace}
            canInstallPlugin={canManagement}
            pluginCategoryToolbarAction={pluginSettingAction}
          />
        </div>
      </section>
    </div>
  )
}
