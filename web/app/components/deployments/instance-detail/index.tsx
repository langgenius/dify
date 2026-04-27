'use client'
import type { ComponentProps, FC, PropsWithoutRef, ReactNode } from 'react'
import type { AppInfo } from '../types'
import type { InstanceDetailTabKey } from './tabs'
import type { NavIcon } from '@/app/components/app-sidebar/nav-link'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useHover, useKeyPress } from 'ahooks'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { getAppModeLabel } from '@/app/components/app-sidebar/app-info/app-mode-labels'
import NavLink from '@/app/components/app-sidebar/nav-link'
import ToggleButton from '@/app/components/app-sidebar/toggle-button'
import { useStore as useAppStore } from '@/app/components/app/store'
import AppIcon from '@/app/components/base/app-icon'
import Divider from '@/app/components/base/divider'
import { getKeyboardKeyCodeBySystem } from '@/app/components/workflow/utils'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter, useSelectedLayoutSegment } from '@/next/navigation'
import DeployDrawer from '../deploy-drawer'
import RollbackModal from '../rollback-modal'
import { useDeploymentsStore } from '../store'
import { useSourceApps } from '../use-source-apps'
import { isInstanceDetailTabKey } from './tabs'

type TabDef = {
  key: InstanceDetailTabKey
  icon: NavIcon
  selectedIcon: NavIcon
}

type TailwindNavIconProps = PropsWithoutRef<ComponentProps<'svg'>> & {
  title?: string
  titleId?: string
}

const OverviewIcon = ({ className }: TailwindNavIconProps) => <span aria-hidden className={cn('i-ri-dashboard-2-line', className)} />
const OverviewSelectedIcon = ({ className }: TailwindNavIconProps) => <span aria-hidden className={cn('i-ri-dashboard-2-fill', className)} />
const DeployIcon = ({ className }: TailwindNavIconProps) => <span aria-hidden className={cn('i-ri-rocket-line', className)} />
const DeploySelectedIcon = ({ className }: TailwindNavIconProps) => <span aria-hidden className={cn('i-ri-rocket-fill', className)} />
const VersionsIcon = ({ className }: TailwindNavIconProps) => <span aria-hidden className={cn('i-ri-stack-line', className)} />
const VersionsSelectedIcon = ({ className }: TailwindNavIconProps) => <span aria-hidden className={cn('i-ri-stack-fill', className)} />
const AccessIcon = ({ className }: TailwindNavIconProps) => <span aria-hidden className={cn('i-ri-plug-line', className)} />
const AccessSelectedIcon = ({ className }: TailwindNavIconProps) => <span aria-hidden className={cn('i-ri-plug-fill', className)} />
const SettingsIcon = ({ className }: TailwindNavIconProps) => <span aria-hidden className={cn('i-ri-settings-3-line', className)} />
const SettingsSelectedIcon = ({ className }: TailwindNavIconProps) => <span aria-hidden className={cn('i-ri-settings-3-fill', className)} />

const TABS: TabDef[] = [
  { key: 'overview', icon: OverviewIcon, selectedIcon: OverviewSelectedIcon },
  { key: 'deploy', icon: DeployIcon, selectedIcon: DeploySelectedIcon },
  { key: 'versions', icon: VersionsIcon, selectedIcon: VersionsSelectedIcon },
  { key: 'access', icon: AccessIcon, selectedIcon: AccessSelectedIcon },
  { key: 'settings', icon: SettingsIcon, selectedIcon: SettingsSelectedIcon },
]

type InstanceDetailProps = {
  instanceId: string
  children: ReactNode
}

const isShortcutFromInputArea = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement))
    return false

  return target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.isContentEditable
}

type DeploymentSidebarProps = {
  instanceId: string
  instanceName: string
  instanceDescription?: string
  appModeLabel: string
  app?: AppInfo
}

const DeploymentSidebar: FC<DeploymentSidebarProps> = ({
  instanceId,
  instanceName,
  instanceDescription,
  appModeLabel,
  app,
}) => {
  const { t } = useTranslation('deployments')
  const sidebarRef = useRef<HTMLDivElement>(null)
  const isHoveringSidebar = useHover(sidebarRef)
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const { appSidebarExpand, setAppSidebarExpand } = useAppStore(useShallow(state => ({
    appSidebarExpand: state.appSidebarExpand,
    setAppSidebarExpand: state.setAppSidebarExpand,
  })))
  const sidebarMode = appSidebarExpand || 'expand'
  const expand = sidebarMode === 'expand'

  const handleToggle = useCallback(() => {
    setAppSidebarExpand(sidebarMode === 'expand' ? 'collapse' : 'expand')
  }, [setAppSidebarExpand, sidebarMode])

  useEffect(() => {
    const persistedMode = localStorage.getItem('app-detail-collapse-or-expand') || 'expand'
    setAppSidebarExpand(isMobile ? 'collapse' : persistedMode)
  }, [isMobile, setAppSidebarExpand])

  useEffect(() => {
    if (appSidebarExpand)
      localStorage.setItem('app-detail-collapse-or-expand', appSidebarExpand)
  }, [appSidebarExpand])

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.b`, (e) => {
    if (isShortcutFromInputArea(e.target))
      return

    e.preventDefault()
    handleToggle()
  }, { exactMatch: true, useCapture: true })

  return (
    <aside
      ref={sidebarRef}
      className={cn(
        'flex shrink-0 flex-col border-r border-divider-burn bg-background-default-subtle transition-all',
        expand ? 'w-[216px]' : 'w-14',
      )}
    >
      <div className={cn('shrink-0', expand ? 'p-2' : 'p-1')}>
        <div className={cn('flex flex-col gap-2 rounded-lg', expand ? 'p-1' : 'items-center p-1')}>
          <div className="flex items-center gap-1">
            {app
              ? (
                  <AppIcon
                    size={expand ? 'large' : 'medium'}
                    iconType={app.iconType}
                    icon={app.icon}
                    background={app.iconBackground}
                    imageUrl={app.iconUrl}
                  />
                )
              : (
                  <div className={cn(
                    'flex items-center justify-center rounded-xl border border-divider-subtle bg-background-default text-text-tertiary',
                    expand ? 'h-10 w-10' : 'h-8 w-8',
                  )}
                  >
                    <span aria-hidden className="i-ri-apps-2-line h-5 w-5" />
                  </div>
                )}
          </div>
          {expand && (
            <div className="flex flex-col items-start gap-1">
              <div className="flex w-full">
                <div className="truncate system-md-semibold whitespace-nowrap text-text-secondary" title={instanceName}>
                  {instanceName}
                </div>
              </div>
              <div className="system-2xs-medium-uppercase whitespace-nowrap text-text-tertiary">
                {appModeLabel}
              </div>
              {instanceDescription && (
                <div
                  className="line-clamp-2 system-xs-regular text-text-tertiary"
                  title={instanceDescription}
                >
                  {instanceDescription}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="relative px-4 py-2">
        <Divider
          type="horizontal"
          bgStyle={expand ? 'gradient' : 'solid'}
          className={cn(
            'my-0 h-px',
            expand
              ? 'bg-linear-to-r from-divider-subtle to-background-gradient-mask-transparent'
              : 'bg-divider-subtle',
          )}
        />
        {!isMobile && isHoveringSidebar && (
          <ToggleButton
            className="absolute top-[-3.5px] -right-3 z-20"
            expand={expand}
            handleToggle={handleToggle}
          />
        )}
      </div>

      <nav
        className={cn(
          'flex grow flex-col gap-y-0.5',
          expand ? 'px-3 py-2' : 'p-3',
        )}
      >
        {TABS.map(tab => (
          <NavLink
            key={tab.key}
            mode={sidebarMode}
            iconMap={{ selected: tab.selectedIcon, normal: tab.icon }}
            name={t(`tabs.${tab.key}.name`)}
            href={`/deployments/${instanceId}/${tab.key}`}
          />
        ))}
      </nav>
    </aside>
  )
}

const InstanceDetail: FC<InstanceDetailProps> = ({ instanceId, children }) => {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation()
  const router = useRouter()
  const selectedSegment = useSelectedLayoutSegment()
  const selectedTab = selectedSegment ?? undefined
  const activeTab: InstanceDetailTabKey = isInstanceDetailTabKey(selectedTab) ? selectedTab : 'overview'
  const instances = useDeploymentsStore(state => state.instances)
  const deployments = useDeploymentsStore(state => state.deployments)
  const { appMap, isLoading: isLoadingApps } = useSourceApps()
  useDocumentTitle(t('documentTitle.detail'))

  const instance = useMemo(() => instances.find(i => i.id === instanceId), [instances, instanceId])
  const app = useMemo(
    () => instance ? appMap.get(instance.appId) : undefined,
    [instance, appMap],
  )
  const instanceDeployments = useMemo(
    () => instance ? deployments.filter(d => d.instanceId === instance.id) : [],
    [deployments, instance],
  )

  if (isLoadingApps && !app) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-components-panel-border border-t-transparent" />
      </div>
    )
  }

  if (!instance) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background-body">
        <div className="title-xl-semi-bold text-text-primary">{t('detail.notFound')}</div>
        <Button variant="secondary" onClick={() => router.push('/deployments')}>
          <span aria-hidden className="i-ri-arrow-left-line h-4 w-4" />
          {t('detail.backToInstances')}
        </Button>
      </div>
    )
  }

  const deployingCount = instanceDeployments.filter(d => d.status === 'deploying').length
  const failedCount = instanceDeployments.filter(d => d.status === 'deploy_failed').length
  const appModeLabel = app ? getAppModeLabel(app.mode, tCommon) : t('detail.sourceAppDeleted')

  return (
    <>
      <div className="relative flex h-full overflow-hidden rounded-t-2xl shadow-[0_0_5px_rgba(0,0,0,0.05),0_0_2px_-1px_rgba(0,0,0,0.03)]">
        <DeploymentSidebar
          instanceId={instanceId}
          instanceName={instance.name}
          instanceDescription={instance.description}
          appModeLabel={appModeLabel}
          app={app}
        />

        <div className="grow overflow-hidden bg-components-panel-bg">
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b border-solid border-b-divider-regular px-6 py-3">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <div className="title-md-semi-bold text-text-primary">{t(`tabs.${activeTab}.name`)}</div>
                </div>
                <div className="system-xs-regular text-text-tertiary">{t(`tabs.${activeTab}.description`)}</div>
              </div>
              <div className="flex items-center gap-2 system-xs-regular text-text-tertiary">
                <span>{t('detail.envCount', { count: instanceDeployments.length })}</span>
                {deployingCount > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-util-colors-warning-warning-700">
                      {t('detail.deployingCount', { count: deployingCount })}
                    </span>
                  </>
                )}
                {failedCount > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-util-colors-red-red-700">
                      {t('detail.failedCount', { count: failedCount })}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="grow overflow-y-auto">
              {children}
            </div>
          </div>
        </div>
      </div>

      <DeployDrawer />
      <RollbackModal />
    </>
  )
}

export default InstanceDetail
