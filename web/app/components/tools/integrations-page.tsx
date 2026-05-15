'use client'

import type { ComponentType, CSSProperties } from 'react'
import type { Permissions, ReferenceSetting } from '@/app/components/plugins/types'
import type { IntegrationSection } from '@/app/components/tools/integration-routes'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@langgenius/dify-ui/toggle-group'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import UpdateSettingPopover from '@/app/components/header/account-setting/update-setting-popover'
import DebugInfo from '@/app/components/plugins/plugin-page/debug-info'
import InstallPluginDropdown from '@/app/components/plugins/plugin-page/install-plugin-dropdown'
import useReferenceSetting from '@/app/components/plugins/plugin-page/use-reference-setting'
import { PermissionType } from '@/app/components/plugins/types'
import {
  buildIntegrationPath,
  INTEGRATION_SECTION_VALUES,
  sectionByToolCategory,
  TOOL_CATEGORY_VALUES,
  toolCategoryBySection,
} from '@/app/components/tools/integration-routes'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { toolsContentInsetClassNames, toolsUnifiedContentFrameClassName } from './content-inset'
import IntegrationSectionRenderer from './integration-section-renderer'

type IconComponent = ComponentType<{ className?: string }>

const parseAsIntegrationSection = parseAsStringLiteral(INTEGRATION_SECTION_VALUES)
const parseAsToolCategory = parseAsStringLiteral(TOOL_CATEGORY_VALUES)

type NavItem = {
  activeIcon?: IconComponent | string
  disabled?: boolean
  icon: IconComponent | string
  iconClassName?: string
  label: string
  section?: IntegrationSection
}

type PermissionSettingKey = keyof Permissions

const permissionSettingOptions = [
  PermissionType.everyone,
  PermissionType.admin,
  PermissionType.noOne,
] as const

const PermissionQuickPanel = ({
  permission,
  onChange,
}: {
  permission: Permissions
  onChange: (key: PermissionSettingKey, value: PermissionType) => void
}) => {
  const { t } = useTranslation()
  const rows: Array<{
    key: PermissionSettingKey
    label: string
    value: PermissionType
  }> = [
    {
      key: 'install_permission',
      label: t('privilege.quickWhoCanInstall', { ns: 'plugin' }),
      value: permission.install_permission || PermissionType.noOne,
    },
    {
      key: 'debug_permission',
      label: t('privilege.quickWhoCanDebug', { ns: 'plugin' }),
      value: permission.debug_permission || PermissionType.noOne,
    },
  ]

  return (
    <div className="w-[249px] overflow-hidden rounded-2xl border-t border-components-panel-border bg-components-panel-bg shadow-xl">
      <div className="border-b-[0.5px] border-black/5 py-2">
        <div className="flex flex-col gap-1 px-1 pt-0.5 pb-1">
          <div className="px-3 pt-1 pb-0.5 system-sm-semibold-uppercase text-text-secondary">
            {t('privilege.permissions', { ns: 'plugin' })}
          </div>
          {rows.map(row => (
            <div key={row.key} className="flex flex-col gap-0.5 px-3 py-1">
              <div className="flex min-h-6 items-center system-sm-semibold whitespace-nowrap text-text-secondary">
                {row.label}
              </div>
              <ToggleGroup<PermissionType>
                value={[row.value]}
                onValueChange={(value) => {
                  const nextValue = value[0]
                  if (nextValue)
                    onChange(row.key, nextValue)
                }}
                aria-label={row.label}
                className="w-fit"
              >
                {permissionSettingOptions.map((option) => {
                  const optionLabel = t(`privilege.${option}`, { ns: 'plugin' })

                  return (
                    <ToggleGroupItem
                      key={option}
                      value={option}
                      aria-label={`${row.label}: ${optionLabel}`}
                      className="shrink-0"
                    >
                      <span className="px-0.5 py-0.5">{optionLabel}</span>
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const navItemClassName = 'flex h-8 w-full items-center gap-2 rounded-lg py-1 pr-1 pl-3 text-left system-sm-medium transition-colors'
const activeNavItemClassName = 'bg-state-base-active system-sm-semibold text-components-menu-item-text-active'
const inactiveNavItemClassName = 'text-components-menu-item-text hover:bg-state-base-hover hover:text-components-menu-item-text-hover'
const disabledNavItemClassName = 'cursor-not-allowed text-components-menu-item-text-disabled'

const buildSectionHref = (section: IntegrationSection) => {
  return buildIntegrationPath(section)
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

type IntegrationsPageProps = {
  section?: IntegrationSection
}

export default function IntegrationsPage({
  section: routeSection,
}: IntegrationsPageProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const {
    referenceSetting,
    canDebugger,
    canSetPermissions,
    setReferenceSettings,
  } = useReferenceSetting()
  const [sectionParam] = useQueryState('section', parseAsIntegrationSection)
  const [categoryParam] = useQueryState('category', parseAsToolCategory)
  const section = routeSection ?? sectionParam ?? (categoryParam ? sectionByToolCategory[categoryParam] : 'provider')
  const [providerSearchText, setProviderSearchText] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const providerItem = useMemo<NavItem>(() => ({
    section: 'provider',
    label: t('settings.provider', { ns: 'common' }),
    icon: 'i-ri-brain-2-line',
    activeIcon: 'i-ri-brain-2-fill',
  }), [t])
  const dataSourceItem = useMemo<NavItem>(() => ({
    section: 'data-source',
    label: t('settings.dataSource', { ns: 'common' }),
    icon: 'i-ri-database-2-line',
    activeIcon: 'i-ri-database-2-fill',
    iconClassName: 'size-4',
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
      label: t('settings.swaggerAPIAsTool', { ns: 'common' }),
      icon: 'i-custom-vender-integrations-custom-tool',
      activeIcon: 'i-custom-vender-integrations-custom-tool-active',
      iconClassName: 'h-[14.5px] w-[12.5px]',
    },
    {
      section: 'workflow-tool',
      label: t('common.workflowAsTool', { ns: 'workflow' }),
      icon: 'i-custom-vender-integrations-workflow-as-tool',
      activeIcon: 'i-custom-vender-integrations-workflow-as-tool-active',
      iconClassName: 'h-3 w-[12.5px]',
    },
    {
      section: 'api-based-extension',
      label: t('settings.apiBasedExtension', { ns: 'common' }),
      icon: 'i-custom-vender-integrations-api-extension',
      activeIcon: 'i-custom-vender-integrations-api-extension-active',
      iconClassName: 'h-[13px] w-3.5',
    },
  ], [t])
  const secondaryItems = useMemo<NavItem[]>(() => [
    {
      section: 'trigger',
      label: t('settings.trigger', { ns: 'common' }),
      icon: 'i-custom-vender-integrations-trigger',
      activeIcon: 'i-custom-vender-integrations-trigger-active',
      iconClassName: 'h-[13.5px] w-[13.5px]',
    },
    {
      section: 'agent-strategy',
      label: t('settings.agentStrategy', { ns: 'common' }),
      icon: 'i-custom-vender-integrations-agent-strategy',
      activeIcon: 'i-custom-vender-integrations-agent-strategy-active',
      iconClassName: 'h-[14.5px] w-[15.5px]',
    },
    {
      section: 'extension',
      label: t('settings.extension', { ns: 'common' }),
      icon: 'i-custom-vender-integrations-extension',
      activeIcon: 'i-custom-vender-integrations-extension-active',
      iconClassName: 'h-[13.5px] w-3',
    },
  ], [t])
  const activeItem = [providerItem, dataSourceItem, ...toolItems, ...secondaryItems].find(item => item.section === section)
  const isToolSection = Boolean(toolCategoryBySection[section])
  const isPluginCategorySection = section === 'trigger' || section === 'agent-strategy' || section === 'extension'
  const useFillLayout = isToolSection || isPluginCategorySection
  const headerFrameClassName = cn(
    toolsContentInsetClassNames.compact,
    toolsUnifiedContentFrameClassName,
  )
  const sidebarWidthStyle = {
    '--integrations-sidebar-width': sidebarCollapsed ? '56px' : '200px',
    '--model-provider-warning-left': `calc(240px + ${sidebarCollapsed ? '56px' : '200px'})`,
  } as CSSProperties & Record<'--integrations-sidebar-width' | '--model-provider-warning-left', string>
  const integrationHeader = useMemo(() => {
    switch (section) {
      case 'builtin':
        return {
          title: t('menus.tools', { ns: 'common' }),
          description: t('toolsPage.description', { ns: 'common' }),
        }
      case 'mcp':
        return {
          title: 'MCP',
          description: t('mcpPage.description', { ns: 'common' }),
        }
      case 'custom-tool':
        return {
          title: t('settings.swaggerAPIAsTool', { ns: 'common' }),
          description: t('swaggerAPIAsToolPage.description', { ns: 'common' }),
        }
      case 'workflow-tool':
        return {
          title: t('common.workflowAsTool', { ns: 'workflow' }),
          description: t('workflowAsToolPage.description', { ns: 'common' }),
        }
      case 'api-based-extension':
        return {
          title: t('settings.apiBasedExtension', { ns: 'common' }),
          description: t('apiBasedExtensionPage.description', { ns: 'common' }),
        }
      case 'data-source':
        return {
          title: t('settings.dataSource', { ns: 'common' }),
          description: t('dataSourcePage.description', { ns: 'common' }),
        }
      case 'trigger':
        return {
          title: t('settings.trigger', { ns: 'common' }),
          description: t('triggerPage.description', { ns: 'common' }),
        }
      case 'extension':
        return {
          title: t('settings.extension', { ns: 'common' }),
          description: t('extensionPage.description', { ns: 'common' }),
        }
      case 'agent-strategy':
        return {
          title: t('settings.agentStrategy', { ns: 'common' }),
          description: t('agentStrategyPage.description', { ns: 'common' }),
        }
      default:
        return null
    }
  }, [section, t])
  const showPluginCategorySetting = isPluginCategorySection && canSetPermissions && !!referenceSetting
  const showPermissionQuickPanel = canSetPermissions && !!referenceSetting
  const handlePermissionChange = (key: PermissionSettingKey, value: PermissionType) => {
    if (!referenceSetting)
      return

    setReferenceSettings({
      ...referenceSetting,
      permission: {
        ...referenceSetting.permission,
        [key]: value,
      },
    } satisfies ReferenceSetting)
  }
  const pluginSettingAction = showPluginCategorySetting
    ? (
        <UpdateSettingPopover
          referenceSetting={referenceSetting}
          onSave={setReferenceSettings}
        />
      )
    : undefined

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
                rootClassName="min-w-0 flex-1"
                triggerVariant="primary"
                triggerClassName="h-8 min-w-0 gap-0.5 p-2 system-sm-medium"
                triggerLabel={t('installAction', { ns: 'plugin' })}
                triggerOpenClassName="bg-components-button-primary-bg-hover"
                popupClassName="w-[240px] rounded-2xl py-2 shadow-xl"
                onSwitchToMarketplaceTab={() => router.push('/plugins?tab=discover')}
              />
              {canDebugger && (
                <div className="size-8 shrink-0">
                  <DebugInfo />
                </div>
              )}
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
                {showPermissionQuickPanel && (
                  <PopoverContent
                    placement="bottom-start"
                    sideOffset={4}
                    popupClassName="border-0 bg-transparent p-0 shadow-none"
                  >
                    <PermissionQuickPanel
                      permission={referenceSetting.permission}
                      onChange={handlePermissionChange}
                    />
                  </PopoverContent>
                )}
              </Popover>
            </div>
          )}
          <nav className="mt-6 shrink-0 space-y-0.5">
            <NavLinkItem collapsed={sidebarCollapsed} item={providerItem} section={section} />
            <NavLinkItem collapsed={sidebarCollapsed} item={dataSourceItem} section={section} />
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
                  <span className={cn(
                    'h-3.5 w-[12.5px]',
                    section === 'builtin' ? 'i-custom-vender-integrations-tools-active' : 'i-custom-vender-integrations-tools',
                  )}
                  />
                </span>
                {!sidebarCollapsed && (
                  <>
                    <span className="min-w-0 flex-1 truncate">{t('menus.tools', { ns: 'common' })}</span>
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
        {integrationHeader && (
          <div className="flex min-h-14 shrink-0 items-start">
            <div className={cn('flex min-w-0 flex-1 items-end justify-between gap-3 pt-2 pb-2', headerFrameClassName)}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="system-xl-semibold text-text-primary">
                  {integrationHeader.title}
                </div>
                <div className="system-sm-regular text-text-tertiary">
                  {integrationHeader.description}
                </div>
              </div>
            </div>
          </div>
        )}
        {!integrationHeader && !isToolSection && (
          <div className="flex min-h-14 shrink-0 items-center justify-between">
            <div className={cn('flex min-w-0 flex-1 items-center justify-between py-2', headerFrameClassName)}>
              <div>
                <div className="system-xl-semibold text-text-primary">{activeItem?.label}</div>
                {section === 'provider' && (
                  <div className="mt-0.5 system-xs-regular text-text-tertiary">
                    {t('modelProvider.pageDesc', { ns: 'common' })}
                  </div>
                )}
              </div>
            </div>
          </div>
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
            pluginCategoryToolbarAction={pluginSettingAction}
          />
        </div>
      </section>
    </div>
  )
}
