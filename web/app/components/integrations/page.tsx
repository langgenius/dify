'use client'

import type { CSSProperties } from 'react'
import type { IntegrationSection } from '@/app/components/integrations/routes'
import { cn } from '@langgenius/dify-ui/cn'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import UpdateSettingPopover from '@/app/components/header/account-setting/update-setting-popover'
import {
  buildIntegrationPath,
  buildMarketplacePathByIntegrationSection,
  toolCategoryBySection,
} from '@/app/components/integrations/routes'
import { toolsContentInsetClassNames, toolsUnifiedContentFrameClassName } from '@/app/components/tools/content-inset'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { getPluginCategoryBySection, useIntegrationNav } from './hooks/use-integration-nav'
import { useIntegrationPermissions } from './hooks/use-integration-permissions'
import { useIntegrationSection } from './hooks/use-integration-section'
import { IntegrationPageHeader } from './page-header'
import IntegrationSectionRenderer from './section-renderer'
import { IntegrationSidebarActions } from './sidebar-actions'
import { IntegrationSidebarMarketplaceCard } from './sidebar-marketplace-card'
import {
  IntegrationSidebarNavItem,
} from './sidebar-nav-item'
import {
  integrationSidebarActiveNavItemClassName,
  integrationSidebarInactiveNavItemClassName,
  integrationSidebarNavItemClassName,
} from './sidebar-nav-item-styles'

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
  const {
    activeItem,
    dataSourceItem,
    integrationHeader,
    providerItem,
    secondaryItems,
    toolItems,
  } = useIntegrationNav(section)
  const isToolSection = Boolean(toolCategoryBySection[section])
  const useFillLayout = section === 'provider' || section === 'data-source' || isToolSection || isPluginCategory
  const headerFrameClassName = cn(
    toolsContentInsetClassNames.compact,
    toolsUnifiedContentFrameClassName,
  )
  const scrollAreaLabel = integrationHeader?.title ?? activeItem?.label
  const sidebarWidthStyle = {
    '--integrations-sidebar-width': '200px',
    '--model-provider-warning-left': 'calc(240px + 200px)',
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
      <span className="min-w-0 flex-1 truncate">{t('menus.tools', { ns: 'common' })}</span>
    </>
  )

  return (
    <div className="flex h-full min-h-0 bg-components-panel-bg" style={sidebarWidthStyle}>
      <aside className={cn(
        'flex shrink-0 flex-col border-r border-divider-burn bg-components-panel-bg px-2 py-2 transition-[width]',
        'w-50 items-end',
      )}
      >
        <div
          className="flex min-h-0 w-46 flex-1 flex-col pb-4"
        >
          <div
            className="flex h-8 shrink-0 items-center py-1"
          >
            <div className="title-3xl-semi-bold whitespace-nowrap text-text-primary">
              {t('settings.integrations', { ns: 'common' })}
            </div>
          </div>
          <IntegrationSidebarActions
            canDebugger={canDebugger}
            canManagement={canManagement}
            installContextCategory={getPluginCategoryBySection(section)}
            permission={permission}
            showPermissionQuickPanel={showPermissionQuickPanel}
            onPermissionChange={handlePermissionChange}
            onSwitchToMarketplace={handleSwitchToMarketplace}
          />
          <nav className="mt-6 shrink-0 space-y-0.5">
            <IntegrationSidebarNavItem item={providerItem} onSelect={onSectionChange} section={section} />
            <IntegrationSidebarNavItem item={dataSourceItem} onSelect={onSectionChange} section={section} />
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
              <div className="space-y-0.5 pl-6">
                {toolItems.map(item => (
                  <IntegrationSidebarNavItem
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
                key={item.label}
                item={item}
                onSelect={onSectionChange}
                section={section}
              />
            ))}
          </nav>
        </div>
        <IntegrationSidebarMarketplaceCard />
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
        {useFillLayout
          ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <IntegrationSectionRenderer
                  key={section}
                  section={section}
                  scrollAreaLabel={scrollAreaLabel}
                  providerSearchText={providerSearchText}
                  onProviderSearchTextChange={setProviderSearchText}
                  onSwitchToMarketplace={handleSwitchToMarketplace}
                  canInstallPlugin={canManagement}
                  pluginCategoryToolbarAction={pluginSettingAction}
                />
              </div>
            )
          : (
              <ScrollArea
                className="min-h-0 flex-1 overflow-hidden"
                label={scrollAreaLabel}
                slotClassNames={{
                  viewport: 'overscroll-contain',
                  content: 'min-h-full',
                  scrollbar: 'data-[orientation=vertical]:my-1 data-[orientation=vertical]:me-1',
                }}
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
              </ScrollArea>
            )}
      </section>
    </div>
  )
}
