'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DatasourceIcon from '@/app/components/base/icons/src/vender/workflow/Datasource'
import ApiBasedExtensionPage from '@/app/components/header/account-setting/api-based-extension-page'
import DataSourcePage from '@/app/components/header/account-setting/data-source-page-new'
import ModelProviderPage from '@/app/components/header/account-setting/model-provider-page'
import Link from '@/next/link'
import ToolProviderList from './provider-list'

const INTEGRATION_SECTION_VALUES = [
  'provider',
  'builtin',
  'mcp',
  'custom-tool',
  'workflow-tool',
  'data-source',
  'api-based-extension',
] as const

type IntegrationSection = typeof INTEGRATION_SECTION_VALUES[number]

const TOOL_CATEGORY_VALUES = ['builtin', 'api', 'workflow', 'mcp'] as const
type ToolCategory = typeof TOOL_CATEGORY_VALUES[number]
type IconComponent = typeof DatasourceIcon

const parseAsIntegrationSection = parseAsStringLiteral(INTEGRATION_SECTION_VALUES)
const parseAsToolCategory = parseAsStringLiteral(TOOL_CATEGORY_VALUES)

const toolCategoryBySection: Partial<Record<IntegrationSection, string>> = {
  'builtin': 'builtin',
  'mcp': 'mcp',
  'custom-tool': 'api',
  'workflow-tool': 'workflow',
}
const sectionByToolCategory: Record<ToolCategory, IntegrationSection> = {
  builtin: 'builtin',
  api: 'custom-tool',
  workflow: 'workflow-tool',
  mcp: 'mcp',
}

type NavItem = {
  activeIcon?: IconComponent | string
  disabled?: boolean
  icon: IconComponent | string
  iconClassName?: string
  label: string
  section?: IntegrationSection
}

const navItemClassName = 'flex h-8 w-full items-center gap-2 rounded-lg py-1 pr-1 pl-3 text-left system-sm-medium transition-colors'
const activeNavItemClassName = 'bg-state-base-active system-sm-semibold text-components-menu-item-text-active'
const inactiveNavItemClassName = 'text-components-menu-item-text hover:bg-state-base-hover hover:text-components-menu-item-text-hover'
const disabledNavItemClassName = 'cursor-not-allowed text-components-menu-item-text-disabled'

const buildSectionHref = (section: IntegrationSection) => {
  const category = toolCategoryBySection[section]
  const params = new URLSearchParams({ section })
  if (category)
    params.set('category', category)

  return `/tools?${params.toString()}`
}

type NavLinkItemProps = {
  collapsed?: boolean
  item: NavItem
  section: IntegrationSection
}

const renderIcon = (icon: IconComponent | string, className = 'size-4') => {
  if (typeof icon === 'string')
    return <span className={cn(className, icon)} />

  const Icon = icon
  return <Icon className={className} />
}

const NavLinkItem = ({ collapsed, item, section }: NavLinkItemProps) => {
  const isActive = item.section === section
  const icon = isActive && item.activeIcon ? item.activeIcon : item.icon

  const className = cn(
    navItemClassName,
    collapsed && 'justify-center px-0',
    isActive ? activeNavItemClassName : inactiveNavItemClassName,
  )

  if (!item.section) {
    return (
      <div
        title={item.label}
        aria-label={item.label}
        className={cn(
          navItemClassName,
          collapsed && 'justify-center px-0',
          disabledNavItemClassName,
        )}
        aria-disabled="true"
      >
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
          {renderIcon(item.icon, item.iconClassName)}
        </span>
        {!collapsed && <span className="min-w-0 truncate">{item.label}</span>}
      </div>
    )
  }

  return (
    <Link
      href={buildSectionHref(item.section)}
      title={item.label}
      aria-label={item.label}
      className={className}
    >
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
        {renderIcon(icon, item.iconClassName)}
      </span>
      {!collapsed && <span className="min-w-0 truncate">{item.label}</span>}
    </Link>
  )
}

export default function IntegrationsPage() {
  const { t } = useTranslation()
  const [sectionParam] = useQueryState('section', parseAsIntegrationSection)
  const [categoryParam] = useQueryState('category', parseAsToolCategory)
  const section = sectionParam ?? (categoryParam ? sectionByToolCategory[categoryParam] : 'provider')
  const [providerSearchText, setProviderSearchText] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const providerItem = useMemo<NavItem>(() => ({
    section: 'provider',
    label: t('settings.provider', { ns: 'common' }),
    icon: 'i-ri-brain-2-line',
    activeIcon: 'i-ri-brain-2-fill',
  }), [t])
  const toolItems = useMemo<NavItem[]>(() => [
    {
      section: 'mcp',
      label: 'MCP',
      icon: 'i-custom-vender-integrations-mcp',
      iconClassName: 'h-[14.5px] w-[13.5px]',
    },
    {
      section: 'custom-tool',
      label: t('settings.customTool', { ns: 'common' }),
      icon: 'i-custom-vender-integrations-custom-tool',
      iconClassName: 'h-[14.5px] w-[12.5px]',
    },
    {
      section: 'workflow-tool',
      label: t('type.workflow', { ns: 'tools' }),
      icon: 'i-custom-vender-integrations-workflow-as-tool',
      iconClassName: 'h-3 w-[12.5px]',
    },
    {
      section: 'api-based-extension',
      label: t('settings.apiBasedExtension', { ns: 'common' }),
      icon: 'i-custom-vender-integrations-api-extension',
      iconClassName: 'h-[13px] w-3.5',
    },
  ], [t])
  const secondaryItems = useMemo<NavItem[]>(() => [
    {
      section: 'data-source',
      label: t('settings.dataSource', { ns: 'common' }),
      icon: DatasourceIcon,
      iconClassName: 'size-4',
    },
    {
      label: t('settings.trigger', { ns: 'common' }),
      icon: 'i-custom-vender-integrations-trigger',
      iconClassName: 'h-[13.5px] w-[13.5px]',
      disabled: true,
    },
    {
      label: t('settings.agentStrategy', { ns: 'common' }),
      icon: 'i-custom-vender-integrations-agent-strategy',
      iconClassName: 'h-[14.5px] w-[15.5px]',
      disabled: true,
    },
    {
      label: t('settings.extension', { ns: 'common' }),
      icon: 'i-custom-vender-integrations-extension',
      iconClassName: 'h-[13.5px] w-3',
      disabled: true,
    },
  ], [t])
  const activeItem = [providerItem, ...toolItems, ...secondaryItems].find(item => item.section === section)
  const isToolSection = Boolean(toolCategoryBySection[section])

  return (
    <div className="flex h-full min-h-0 bg-background-body">
      <aside className={cn(
        'flex shrink-0 flex-col border-r border-divider-burn bg-background-body px-2 py-2 transition-[width]',
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
              <button
                type="button"
                disabled
                className="flex h-8 min-w-0 flex-1 cursor-not-allowed items-center justify-center gap-0.5 rounded-lg border-[0.5px] border-components-button-primary-border bg-components-button-primary-bg px-2 system-sm-medium text-components-button-primary-text opacity-60 shadow-xs"
                title={t('installAction', { ns: 'plugin' })}
              >
                <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
                <span className="min-w-0 truncate pl-1">{t('installAction', { ns: 'plugin' })}</span>
                <span aria-hidden className="i-ri-arrow-down-s-line size-4 shrink-0" />
              </button>
              <button
                type="button"
                disabled
                className="flex size-8 shrink-0 cursor-not-allowed items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg text-components-button-secondary-text opacity-60 shadow-xs"
                aria-label={t('settings.filter', { ns: 'common' })}
                title={t('settings.filter', { ns: 'common' })}
              >
                <span aria-hidden className="i-ri-equalizer-2-line size-4" />
              </button>
            </div>
          )}
          <nav className="mt-6 shrink-0 space-y-0.5">
            <NavLinkItem collapsed={sidebarCollapsed} item={providerItem} section={section} />
            <div>
              <Link
                href={buildSectionHref('builtin')}
                title={t('menus.tools', { ns: 'common' })}
                aria-label={t('menus.tools', { ns: 'common' })}
                className={cn(
                  navItemClassName,
                  sidebarCollapsed && 'justify-center px-0',
                  section === 'builtin' ? activeNavItemClassName : inactiveNavItemClassName,
                )}
              >
                <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
                  <span className="i-custom-vender-integrations-tools h-3.5 w-[12.5px]" />
                </span>
                {!sidebarCollapsed && (
                  <>
                    <span className="min-w-0 flex-1 truncate">{t('menus.tools', { ns: 'common' })}</span>
                    <span aria-hidden className="i-ri-arrow-down-s-fill size-4 shrink-0" />
                  </>
                )}
              </Link>
              <div className={cn('space-y-0.5', !sidebarCollapsed && 'pl-6')}>
                {toolItems.map(item => (
                  <NavLinkItem
                    collapsed={sidebarCollapsed}
                    key={item.label}
                    item={item}
                    section={section}
                  />
                ))}
              </div>
            </div>
            {secondaryItems.map(item => (
              <NavLinkItem
                collapsed={sidebarCollapsed}
                key={item.label}
                item={item}
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
        {!isToolSection && (
          <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-divider-subtle px-6 py-2">
            <div>
              <div className="system-xl-semibold text-text-primary">{activeItem?.label}</div>
              {section === 'provider' && (
                <div className="mt-0.5 system-xs-regular text-text-tertiary">
                  {t('modelProvider.pageDesc', { ns: 'common' })}
                </div>
              )}
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {section === 'provider' && (
            <div className="px-6 pt-6">
              <ModelProviderPage
                searchText={providerSearchText}
                onSearchTextChange={setProviderSearchText}
              />
            </div>
          )}
          {section === 'data-source' && (
            <div className="px-6 pt-6">
              <DataSourcePage />
            </div>
          )}
          {section === 'api-based-extension' && (
            <div className="px-6 pt-6">
              <ApiBasedExtensionPage />
            </div>
          )}
          {isToolSection && <ToolProviderList />}
        </div>
      </section>
    </div>
  )
}
