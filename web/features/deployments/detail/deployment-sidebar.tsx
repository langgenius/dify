'use client'

import type { ComponentProps, PropsWithoutRef } from 'react'
import type { InstanceDetailTabKey } from './tabs'
import type { NavIcon } from '@/app/components/app-sidebar/nav-link'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useHover, useKeyPress } from 'ahooks'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import NavLink from '@/app/components/app-sidebar/nav-link'
import ToggleButton from '@/app/components/app-sidebar/toggle-button'
import Divider from '@/app/components/base/divider'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import { getKeyboardKeyCodeBySystem } from '@/app/components/workflow/utils'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useLocalStorage } from '@/hooks/use-local-storage'
import { consoleQuery } from '@/service/client'
import { DeploymentActionsMenu } from '../components/deployment-actions'
import { TitleTooltip } from '../components/title-tooltip'

type TabDef = {
  key: InstanceDetailTabKey
  icon: NavIcon
  selectedIcon: NavIcon
}

type DeploymentSidebarMode = 'expand' | 'collapse'

const DEPLOYMENT_SIDEBAR_MODE_KEY = 'deployment-sidebar-collapse-or-expand'

type TailwindNavIconProps = PropsWithoutRef<ComponentProps<'svg'>> & {
  title?: string
  titleId?: string
}

function OverviewIcon({ className }: TailwindNavIconProps) {
  return <span aria-hidden className={cn('i-ri-dashboard-2-line', className)} />
}
function OverviewSelectedIcon({ className }: TailwindNavIconProps) {
  return <span aria-hidden className={cn('i-ri-dashboard-2-fill', className)} />
}
function DeployIcon({ className }: TailwindNavIconProps) {
  return <span aria-hidden className={cn('i-ri-server-line', className)} />
}
function DeploySelectedIcon({ className }: TailwindNavIconProps) {
  return <span aria-hidden className={cn('i-ri-server-fill', className)} />
}
function VersionsIcon({ className }: TailwindNavIconProps) {
  return <span aria-hidden className={cn('i-ri-stack-line', className)} />
}
function VersionsSelectedIcon({ className }: TailwindNavIconProps) {
  return <span aria-hidden className={cn('i-ri-stack-fill', className)} />
}
function AccessIcon({ className }: TailwindNavIconProps) {
  return <span aria-hidden className={cn('i-ri-shield-user-line', className)} />
}
function AccessSelectedIcon({ className }: TailwindNavIconProps) {
  return <span aria-hidden className={cn('i-ri-shield-user-fill', className)} />
}
function ApiIcon({ className }: TailwindNavIconProps) {
  return <span aria-hidden className={cn('i-ri-code-s-slash-line', className)} />
}
function ApiSelectedIcon({ className }: TailwindNavIconProps) {
  return <span aria-hidden className={cn('i-ri-code-s-slash-fill', className)} />
}

const TABS: TabDef[] = [
  { key: 'overview', icon: OverviewIcon, selectedIcon: OverviewSelectedIcon },
  { key: 'instances', icon: DeployIcon, selectedIcon: DeploySelectedIcon },
  { key: 'releases', icon: VersionsIcon, selectedIcon: VersionsSelectedIcon },
  { key: 'access', icon: AccessIcon, selectedIcon: AccessSelectedIcon },
  { key: 'api-tokens', icon: ApiIcon, selectedIcon: ApiSelectedIcon },
]

function isShortcutFromInputArea(target: EventTarget | null) {
  if (!(target instanceof HTMLElement))
    return false

  return target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.isContentEditable
}

function useDeploymentSidebarMode(isMobile: boolean) {
  const [persistedMode, setPersistedMode] = useLocalStorage<DeploymentSidebarMode>(
    DEPLOYMENT_SIDEBAR_MODE_KEY,
    'expand',
  )
  const sidebarMode = isMobile ? 'collapse' : persistedMode ?? 'expand'

  function toggleSidebarMode() {
    setPersistedMode(sidebarMode === 'expand' ? 'collapse' : 'expand')
  }

  return {
    sidebarMode,
    toggleSidebarMode,
  }
}

type DeploymentSidebarProps = {
  appInstanceId: string
}

function DeploymentIcon({ expand }: {
  expand: boolean
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-components-icon-bg-blue-solid text-text-primary-on-surface',
        expand ? 'size-10' : 'size-8',
      )}
    >
      <span aria-hidden className={cn('i-ri-rocket-fill', expand ? 'size-5' : 'size-4')} />
    </div>
  )
}

function DeploymentSidebarInstanceInfo({ appInstanceId, expand }: {
  appInstanceId: string
  expand: boolean
}) {
  const { t } = useTranslation('deployments')
  const overviewQuery = useQuery(consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const app = overviewQuery.data?.appInstance
  const isLoading = !app?.id && overviewQuery.isLoading
  const isUnavailable = !app?.id || overviewQuery.isError
  const instanceName = app?.name ?? appInstanceId

  return (
    <div className={cn('shrink-0', expand ? 'p-2' : 'p-1')}>
      <div className={cn('flex flex-col gap-2 rounded-lg', expand ? 'p-1' : 'items-center p-1')}>
        {isLoading
          ? (
              <>
                <SkeletonRectangle className={cn('my-0 animate-pulse rounded-lg', expand ? 'size-10' : 'size-8')} />
                {expand && (
                  <SkeletonContainer className="w-full gap-1">
                    <SkeletonRectangle className="my-0 h-5 w-32 animate-pulse" />
                    <SkeletonRectangle className="my-0 h-3 w-20 animate-pulse" />
                  </SkeletonContainer>
                )}
              </>
            )
          : isUnavailable
            ? (
                <>
                  <div className="flex size-8 items-center justify-center rounded-lg bg-components-icon-bg-orange-solid text-text-primary-on-surface">
                    <span className="i-ri-rocket-line size-4" />
                  </div>
                  {expand && (
                    <div className="flex flex-col items-start gap-1">
                      <div className="truncate system-md-semibold whitespace-nowrap text-text-secondary">
                        {t('detail.notFound')}
                      </div>
                      <TitleTooltip content={appInstanceId}>
                        <div className="max-w-full truncate font-mono system-2xs-regular text-text-tertiary">
                          {appInstanceId}
                        </div>
                      </TitleTooltip>
                    </div>
                  )}
                </>
              )
            : (
                <>
                  <DeploymentIcon expand={expand} />
                  {expand && (
                    <div className="flex min-w-0 flex-col items-start gap-1">
                      <div className="flex w-full min-w-0 items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <TitleTooltip content={instanceName}>
                            <div className="truncate system-md-semibold whitespace-nowrap text-text-secondary">
                              {instanceName}
                            </div>
                          </TitleTooltip>
                        </div>
                        <DeploymentActionsMenu
                          appInstanceId={appInstanceId}
                          appName={instanceName}
                          placement="bottom-end"
                          sideOffset={4}
                          className="-mt-1 shrink-0"
                          triggerClassName="bg-transparent shadow-none"
                        />
                      </div>
                      {app.description && (
                        <TitleTooltip content={app.description}>
                          <div className="line-clamp-2 system-xs-regular text-text-tertiary">
                            {app.description}
                          </div>
                        </TitleTooltip>
                      )}
                    </div>
                  )}
                </>
              )}
      </div>
    </div>
  )
}

export function DeploymentSidebar({ appInstanceId }: DeploymentSidebarProps) {
  const { t } = useTranslation('deployments')
  const sidebarRef = useRef<HTMLDivElement>(null)
  const isHoveringSidebar = useHover(sidebarRef)
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const { sidebarMode, toggleSidebarMode } = useDeploymentSidebarMode(isMobile)
  const expand = sidebarMode === 'expand'

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.b`, (e) => {
    if (isShortcutFromInputArea(e.target))
      return

    e.preventDefault()
    toggleSidebarMode()
  }, { exactMatch: true, useCapture: true })

  return (
    <aside
      ref={sidebarRef}
      className={cn(
        'hidden shrink-0 flex-col border-r border-divider-burn bg-background-default-subtle transition-all pc:flex',
        expand ? 'w-54' : 'w-14',
      )}
    >
      <DeploymentSidebarInstanceInfo appInstanceId={appInstanceId} expand={expand} />

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
            className="absolute -top-1 -right-3 z-20"
            expand={expand}
            handleToggle={toggleSidebarMode}
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
            href={`/deployments/${appInstanceId}/${tab.key}`}
          />
        ))}
      </nav>
    </aside>
  )
}
