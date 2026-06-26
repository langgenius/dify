'use client'

import type { ComponentProps, PropsWithoutRef } from 'react'
import type { InstanceDetailTabKey } from './tabs'
import type { NavIcon } from '@/app/components/app-sidebar/nav-link'
import { cn } from '@langgenius/dify-ui/cn'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import NavLink from '@/app/components/app-sidebar/nav-link'
import ToggleButton from '@/app/components/app-sidebar/toggle-button'
import Divider from '@/app/components/base/divider'
import SidebarLeftArrowIcon from '@/app/components/base/icons/src/vender/SidebarLeftArrowIcon'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import { useSetGotoAnythingOpen } from '@/app/components/goto-anything/atoms'
import Link from '@/next/link'
import { usePathname, useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { DeploymentActionsMenu } from '../components/deployment-actions'
import { TitleTooltip } from '../components/title-tooltip'

type TabDef = {
  key: InstanceDetailTabKey
  icon: NavIcon
  selectedIcon: NavIcon
}

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

const DEPLOYMENT_TABS: TabDef[] = [
  { key: 'overview', icon: OverviewIcon, selectedIcon: OverviewSelectedIcon },
  { key: 'instances', icon: DeployIcon, selectedIcon: DeploySelectedIcon },
  { key: 'releases', icon: VersionsIcon, selectedIcon: VersionsSelectedIcon },
  { key: 'access', icon: AccessIcon, selectedIcon: AccessSelectedIcon },
  { key: 'api-tokens', icon: ApiIcon, selectedIcon: ApiSelectedIcon },
]

const SEARCH_SHORTCUT = ['Mod', 'K']

const getDeploymentIdFromPathname = (pathname: string) => {
  const [section, appInstanceId] = pathname.split('/').filter(Boolean)
  return section === 'deployments' ? appInstanceId : undefined
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

function DeploymentDetailInstanceInfo({ appInstanceId, expand }: {
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
  const isLoading = !app && overviewQuery.isLoading
  const isUnavailable = !app || overviewQuery.isError
  const instanceName = app ? app.displayName : appInstanceId

  return (
    <div
      className={cn(
        'rounded-xl hover:bg-state-base-hover',
        expand ? 'flex items-start gap-2 p-2' : 'flex items-center justify-center px-1 py-1.5',
      )}
      aria-label={!expand ? instanceName : undefined}
    >
      {isLoading
        ? (
            <>
              <SkeletonRectangle className={cn('my-0 animate-pulse rounded-lg', expand ? 'size-10' : 'size-8')} />
              {expand && (
                <SkeletonContainer className="min-w-0 flex-1 gap-1">
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
                  <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-0.5 self-stretch">
                    <div className="w-full min-w-0 pr-1">
                      <div className="truncate system-md-semibold whitespace-nowrap text-text-secondary">
                        {t('detail.notFound')}
                      </div>
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
                  <>
                    <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-0.5 self-stretch">
                      <div className="w-full min-w-0 pr-1">
                        <TitleTooltip content={instanceName}>
                          <div className="truncate system-md-semibold whitespace-nowrap text-text-secondary">
                            {instanceName}
                          </div>
                        </TitleTooltip>
                      </div>
                      {app.description && (
                        <TitleTooltip content={app.description}>
                          <div className="line-clamp-2 system-xs-regular text-text-tertiary">
                            {app.description}
                          </div>
                        </TitleTooltip>
                      )}
                    </div>
                    <DeploymentActionsMenu
                      appInstanceId={appInstanceId}
                      appName={instanceName}
                      placement="bottom-end"
                      sideOffset={4}
                      className="shrink-0"
                      triggerClassName="size-5 rounded-md bg-transparent p-0.5 shadow-none"
                    />
                  </>
                )}
              </>
            )}
    </div>
  )
}

export function DeploymentDetailTop({
  expand = true,
  onToggle,
}: {
  expand?: boolean
  onToggle?: () => void
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const setGotoAnythingOpen = useSetGotoAnythingOpen()

  if (!expand) {
    return (
      <div className="flex w-full items-center justify-center px-3 pt-2 pb-1">
        {onToggle && (
          <ToggleButton
            expand={expand}
            handleToggle={onToggle}
            icon={<SidebarLeftArrowIcon aria-hidden className="size-4" />}
            className="size-8 rounded-[10px] border-0 bg-transparent px-0 text-text-tertiary shadow-none hover:border-0 hover:bg-state-base-hover hover:text-text-secondary"
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center py-2 pr-2 pl-1">
      <div className="flex min-w-0 flex-1 items-center gap-px">
        <div className="flex shrink-0 items-center rounded-lg py-2 pr-1.5 pl-0.5 transition-colors hover:bg-background-default-hover">
          <button
            type="button"
            aria-label={t('operation.back', { ns: 'common' })}
            className="flex size-4 items-center justify-center text-text-tertiary hover:text-text-secondary"
            onClick={() => router.back()}
          >
            <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
          </button>
          <Link
            href="/"
            aria-label={t('mainNav.home', { ns: 'common' })}
            className="flex size-4 items-center justify-center text-text-tertiary hover:text-text-secondary"
          >
            <span aria-hidden className="i-custom-vender-main-nav-app-home size-4" />
          </Link>
        </div>
        <span className="shrink-0 system-md-regular text-text-quaternary">
          /
        </span>
        <Link
          href="/deployments"
          className="shrink-0 truncate rounded-lg px-1.5 py-2 system-sm-semibold-uppercase text-text-secondary transition-colors hover:bg-background-default-hover hover:text-text-primary"
        >
          {t('menus.deployments', { ns: 'common' })}
        </Link>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={(
            <button
              type="button"
              aria-label={t('gotoAnything.searchTitle', { ns: 'app' })}
              className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
              onClick={() => setGotoAnythingOpen(true)}
            >
              <span aria-hidden className="i-custom-vender-main-nav-quick-search size-4" />
            </button>
          )}
        />
        <TooltipContent placement="bottom" className="flex items-center gap-1 rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg p-1.5 system-xs-medium text-text-secondary shadow-lg backdrop-blur-[5px]">
          <span className="px-0.5">{t('gotoAnything.quickAction', { ns: 'app' })}</span>
          <KbdGroup>
            {SEARCH_SHORTCUT.map(key => (
              <Kbd key={key}>{formatForDisplay(key)}</Kbd>
            ))}
          </KbdGroup>
        </TooltipContent>
      </Tooltip>
      {onToggle && (
        <ToggleButton
          expand={expand}
          handleToggle={onToggle}
          icon={<SidebarLeftArrowIcon aria-hidden className="size-4" />}
          className="size-8 rounded-[10px] border-0 bg-transparent px-0 text-text-tertiary shadow-none hover:border-0 hover:bg-state-base-hover hover:text-text-secondary"
        />
      )}
    </div>
  )
}

export function DeploymentDetailSection({
  expand = true,
}: {
  expand?: boolean
}) {
  const { t } = useTranslation('deployments')
  const pathname = usePathname()
  const appInstanceId = getDeploymentIdFromPathname(pathname)

  if (!appInstanceId)
    return null

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', expand ? 'px-2 pb-2' : 'pb-2')}>
      {!expand && (
        <div className="flex w-full shrink-0 justify-center px-3.5 pt-0.5 pb-[3px]">
          <Divider
            type="horizontal"
            bgStyle="solid"
            className="my-0 h-px w-[27px] bg-divider-subtle"
          />
        </div>
      )}
      <div className="px-1 py-2">
        <DeploymentDetailInstanceInfo appInstanceId={appInstanceId} expand={expand} />
      </div>

      <nav className={cn('flex flex-col gap-y-0.5 py-1', expand ? 'px-1' : 'px-3')}>
        {DEPLOYMENT_TABS.map(tab => (
          <NavLink
            key={tab.key}
            mode={expand ? 'expand' : 'collapse'}
            iconMap={{ selected: tab.selectedIcon, normal: tab.icon }}
            name={t(`tabs.${tab.key}.name`)}
            href={`/deployments/${appInstanceId}/${tab.key}`}
            pathname={pathname}
          />
        ))}
      </nav>
    </div>
  )
}
