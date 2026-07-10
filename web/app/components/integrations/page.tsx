'use client'

import type { CSSProperties, ReactNode } from 'react'
import type { IntegrationSection } from '@/app/components/integrations/routes'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { cn } from '@langgenius/dify-ui/cn'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import UpdateSettingDialog from '@/app/components/header/account-setting/update-setting-dialog'
import {
  buildIntegrationPath,
  buildMarketplaceUrlPathByIntegrationSection,
  toolCategoryBySection,
} from '@/app/components/integrations/routes'
import { useDocLink } from '@/context/i18n'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { getMarketplaceUrl } from '@/utils/var'
import { STEP_BY_STEP_TOUR_TARGETS } from '../step-by-step-tour/target-registry'
import { getPluginCategoryBySection, useIntegrationNav } from './hooks/use-integration-nav'
import { useIntegrationPermissions } from './hooks/use-integration-permissions'
import { useIntegrationSection } from './hooks/use-integration-section'
import IntegrationSectionRenderer from './section-renderer'
import { IntegrationSidebarActions, IntegrationSidebarUtilityActions } from './sidebar-actions'
import {
  IntegrationSidebarNavItem,
} from './sidebar-nav-item'
import {
  integrationSidebarInactiveNavItemClassName,
  integrationSidebarNavItemClassName,
} from './sidebar-nav-item-styles'

type IntegrationsPageProps = {
  onSectionChange?: (section: IntegrationSection) => void
  onSwitchToMarketplace?: (path: string) => void
  section?: IntegrationSection
}

const headerDescriptionDocPaths = {
  'provider': '/use-dify/workspace/model-providers',
  'data-source': '/develop-plugin/dev-guides-and-walkthroughs/datasource-plugin#data-source-plugin-types',
  'builtin': '/use-dify/workspace/tools',
  'custom-tool': '/use-dify/workspace/tools#swagger-api',
  'workflow-tool': '/use-dify/workspace/tools#workflow',
  'mcp': '/use-dify/workspace/tools#mcp',
  'custom-endpoint': '/develop-plugin/dev-guides-and-walkthroughs/endpoint',
  'trigger': '/develop-plugin/dev-guides-and-walkthroughs/trigger-plugin',
  'extension': '/use-dify/workspace/api-extension/api-extension',
  'agent-strategy': '/develop-plugin/dev-guides-and-walkthroughs/agent-strategy-plugin',
} satisfies Partial<Record<IntegrationSection, DocPathWithoutLang>>

type DescriptionWithLearnMoreProps = {
  children: ReactNode
  href: string
  label: string
}

const DescriptionWithLearnMore = ({
  children,
  href,
  label,
}: DescriptionWithLearnMoreProps) => {
  const title = typeof children === 'string' ? children : undefined

  return (
    <span className="inline-flex min-w-0 items-center gap-0.5">
      <span className="truncate" title={title}>{children}</span>
      <Link
        className="inline-flex shrink-0 items-center text-text-accent"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {label}
        <span aria-hidden className="i-ri-external-link-line size-3" />
      </Link>
    </span>
  )
}

function ToolsDisclosureIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 12 14.0003"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8 10.0003H4V8.66693H8V10.0003Z" fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d="M11.5814 2.43842L9.84375 5.3336H11.3333C11.7015 5.3336 12 5.63208 12 6.00027V13.3336C11.9998 13.7016 11.7014 14.0003 11.3333 14.0003H0.666667C0.298582 14.0003 0.000170884 13.7016 0 13.3336V6.00027C0 5.63208 0.298477 5.3336 0.666667 5.3336H8.28906L10.4382 1.75222L11.5814 2.43842ZM1.33333 12.6669H10.6667V6.66693H1.33333V12.6669Z" fill="currentColor" />
      <path d="M2.79297 1.4612C2.87822 1.2907 3.12178 1.2907 3.20703 1.4612L3.50521 2.05821C3.52758 2.10284 3.56408 2.13873 3.60872 2.16107L4.20573 2.4599C4.37584 2.54523 4.37584 2.78798 4.20573 2.87331L3.60872 3.17214C3.564 3.19452 3.52757 3.23092 3.50521 3.27566L3.20703 3.87201C3.12178 4.04251 2.87822 4.04251 2.79297 3.87201L2.49479 3.27566C2.47243 3.23092 2.436 3.19452 2.39128 3.17214L1.79427 2.87331C1.62416 2.78798 1.62416 2.54523 1.79427 2.4599L2.39128 2.16107C2.43592 2.13873 2.47242 2.10284 2.49479 2.05821L2.79297 1.4612Z" fill="currentColor" />
      <path d="M6.4082 0.159771C6.51476 -0.0532568 6.81858 -0.0532568 6.92513 0.159771L7.29818 0.905864C7.32618 0.96178 7.37176 1.0068 7.42773 1.03477L8.17318 1.40782C8.38631 1.51438 8.38631 1.81884 8.17318 1.9254L7.42773 2.29844C7.37177 2.32641 7.32618 2.37144 7.29818 2.42735L6.92513 3.17344C6.81858 3.38649 6.51475 3.38649 6.4082 3.17344L6.03516 2.42735C6.00715 2.37144 5.96157 2.32641 5.9056 2.29844L5.16016 1.9254C4.94702 1.81884 4.94702 1.51438 5.16016 1.40782L5.9056 1.03477C5.96157 1.0068 6.00715 0.96178 6.03516 0.905864L6.4082 0.159771Z" fill="currentColor" />
    </svg>
  )
}

export default function IntegrationsPage({
  onSectionChange,
  onSwitchToMarketplace,
  section: routeSection,
}: IntegrationsPageProps) {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const router = useRouter()
  const section = useIntegrationSection(routeSection)
  const {
    canDebugger,
    canInstallPlugin,
    canDeletePlugin,
    canUpdatePlugin,
    handlePermissionChange,
    isPluginCategory,
    isReferenceSettingLoading,
    permission,
    showPermissionQuickPanel,
    showPluginCategorySetting,
  } = useIntegrationPermissions(section)
  const [providerSearchText, setProviderSearchText] = useState('')
  const showInstallAction = canInstallPlugin
  const reserveInstallActionSlot = showInstallAction || isReferenceSettingLoading
  const showUtilityActions = canDebugger || showPermissionQuickPanel
  const {
    activeItem,
    customEndpointItem,
    dataSourceItem,
    integrationHeader,
    providerItem,
    secondaryItems,
    toolItems,
  } = useIntegrationNav(section)
  const isToolSection = Boolean(toolCategoryBySection[section])
  const [isToolsExpanded, setIsToolsExpanded] = useState(isToolSection)
  useEffect(() => {
    if (!isToolSection)
      return undefined

    const animationFrame = window.requestAnimationFrame(() => setIsToolsExpanded(true))

    return () => window.cancelAnimationFrame(animationFrame)
  }, [isToolSection])
  const useFillLayout = section === 'provider' || section === 'data-source' || section === 'custom-endpoint' || isToolSection || isPluginCategory
  const scrollAreaLabel = integrationHeader?.title ?? activeItem?.label
  const sidebarWidthStyle = {
    '--integrations-sidebar-width': '200px',
    '--model-provider-warning-left': 'calc(240px + 200px)',
  } as CSSProperties & Record<'--integrations-sidebar-width' | '--model-provider-warning-left', string>
  const pluginSettingCategory = getPluginCategoryBySection(section)
  const pluginSettingAction = showPluginCategorySetting && pluginSettingCategory
    ? (
        <div data-step-by-step-tour-target={section === 'builtin' ? STEP_BY_STEP_TOUR_TARGETS.integrationUpdateSettings : undefined}>
          <UpdateSettingDialog
            category={pluginSettingCategory}
          />
        </div>
      )
    : undefined
  const marketplaceUrlPath = buildMarketplaceUrlPathByIntegrationSection(section)
  const headerDescription = integrationHeader?.description ?? (section === 'provider' ? t($ => $['modelProvider.pageDesc'], { ns: 'common' }) : undefined)
  const headerDescriptionDocPath = headerDescriptionDocPaths[section]
  const headerDescriptionWithLink = headerDescription && headerDescriptionDocPath
    ? (
        <DescriptionWithLearnMore
          href={docLink(headerDescriptionDocPath)}
          label={t($ => $['modelProvider.learnMore'], { ns: 'common' })}
        >
          {headerDescription}
        </DescriptionWithLearnMore>
      )
    : headerDescription
  const handleSwitchToMarketplace = () => {
    if (onSwitchToMarketplace) {
      onSwitchToMarketplace(marketplaceUrlPath)
      return
    }

    window.open(getMarketplaceUrl(marketplaceUrlPath, undefined, { source: window.location.origin }), '_blank', 'noopener,noreferrer')
  }
  const handleSelectSection = (nextSection: IntegrationSection) => {
    if (onSectionChange) {
      onSectionChange(nextSection)
      return
    }

    router.push(buildIntegrationPath(nextSection))
  }
  const handleToggleTools = () => {
    const willExpand = !isToolsExpanded
    setIsToolsExpanded(willExpand)
    if (willExpand && section !== 'builtin')
      handleSelectSection('builtin')
  }
  const toolsNavItemClassName = cn(
    integrationSidebarNavItemClassName,
    integrationSidebarInactiveNavItemClassName,
    'group',
  )
  const toolsNavItemContent = (
    <>
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
        <ToolsDisclosureIcon className="h-3.5 w-3 group-hover:hidden" />
        {isToolsExpanded
          ? <span className="i-ri-arrow-up-s-line hidden size-4 group-hover:inline-block" />
          : <span className="i-ri-arrow-down-s-line hidden size-4 group-hover:inline-block" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{t($ => $['menus.tools'], { ns: 'common' })}</span>
    </>
  )

  return (
    <div className="flex h-full min-h-0 w-full flex-1 bg-components-panel-bg" style={sidebarWidthStyle}>
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-divider-burn bg-components-panel-bg px-2 py-2 transition-[width]',
          'w-50 items-end',
        )}
        data-step-by-step-tour-target={STEP_BY_STEP_TOUR_TARGETS.integration}
      >
        <div
          className="flex min-h-0 w-46 flex-1 flex-col gap-0.5 pb-4"
        >
          <div
            className={cn(
              'flex shrink-0 items-start pr-0 pl-2.5',
              reserveInstallActionSlot ? 'h-14 pt-1 pb-7' : 'mb-3 pt-1 pb-0.5',
            )}
          >
            <div className="flex h-6 min-w-0 flex-1 items-center justify-center">
              <div className="min-w-0 flex-1 title-2xl-semi-bold text-text-primary">
                {t($ => $['settings.integrations'], { ns: 'common' })}
              </div>
            </div>
          </div>
          {showInstallAction && (
            <IntegrationSidebarActions
              canManagement={canInstallPlugin}
              installContextCategory={getPluginCategoryBySection(section)}
              onSwitchToMarketplace={handleSwitchToMarketplace}
            />
          )}
          {!showInstallAction && reserveInstallActionSlot && <div aria-hidden="true" className="h-8 w-full shrink-0" />}
          <nav className={cn('shrink-0 space-y-px', reserveInstallActionSlot ? 'mt-6' : 'py-4')}>
            <IntegrationSidebarNavItem item={providerItem} onSelect={onSectionChange} section={section} />
            <div>
              <button
                type="button"
                aria-label={t($ => $['menus.tools'], { ns: 'common' })}
                aria-expanded={isToolsExpanded}
                className={cn(toolsNavItemClassName, 'border-none bg-transparent')}
                onClick={handleToggleTools}
              >
                {toolsNavItemContent}
              </button>
              {isToolsExpanded && (
                <div className="relative space-y-px before:absolute before:top-[-1px] before:bottom-0 before:left-[17.5px] before:w-px before:bg-divider-regular">
                  {toolItems.map(item => (
                    <IntegrationSidebarNavItem
                      key={item.label}
                      item={item}
                      onSelect={onSectionChange}
                      section={section}
                    />
                  ))}
                </div>
              )}
            </div>
            <IntegrationSidebarNavItem item={dataSourceItem} onSelect={onSectionChange} section={section} />
            {secondaryItems.map(item => (
              <IntegrationSidebarNavItem
                key={item.label}
                item={item}
                onSelect={onSectionChange}
                section={section}
              />
            ))}
            <IntegrationSidebarNavItem item={customEndpointItem} onSelect={onSectionChange} section={section} />
          </nav>
        </div>
        {showUtilityActions && (
          <IntegrationSidebarUtilityActions
            canDebugger={canDebugger}
            permission={permission}
            showPermissionQuickPanel={showPermissionQuickPanel}
            onPermissionChange={handlePermissionChange}
          />
        )}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {useFillLayout
          ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <IntegrationSectionRenderer
                  key={section}
                  section={section}
                  title={integrationHeader?.title ?? activeItem?.label}
                  description={headerDescriptionWithLink}
                  scrollAreaLabel={scrollAreaLabel}
                  providerSearchText={providerSearchText}
                  onProviderSearchTextChange={setProviderSearchText}
                  onSwitchToMarketplace={handleSwitchToMarketplace}
                  canInstallPlugin={canInstallPlugin}
                  canDeletePlugin={canDeletePlugin}
                  isInstallPermissionLoading={isReferenceSettingLoading}
                  canUpdatePlugin={canUpdatePlugin}
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
                }}
              >
                <IntegrationSectionRenderer
                  key={section}
                  section={section}
                  title={integrationHeader?.title ?? activeItem?.label}
                  description={headerDescriptionWithLink}
                  providerSearchText={providerSearchText}
                  onProviderSearchTextChange={setProviderSearchText}
                  onSwitchToMarketplace={handleSwitchToMarketplace}
                  canInstallPlugin={canInstallPlugin}
                  canDeletePlugin={canDeletePlugin}
                  isInstallPermissionLoading={isReferenceSettingLoading}
                  canUpdatePlugin={canUpdatePlugin}
                  pluginCategoryToolbarAction={pluginSettingAction}
                />
              </ScrollArea>
            )}
      </section>
    </div>
  )
}
