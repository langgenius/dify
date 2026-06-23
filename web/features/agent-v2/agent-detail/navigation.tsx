'use client'

import type { AgentIconType } from '@dify/contracts/api/console/agent/types.gen'
import type { ComponentProps } from 'react'
import type { AgentDetailSectionKey } from './section'
import type { NavIcon } from '@/app/components/app-sidebar/nav-link'
import { cn } from '@langgenius/dify-ui/cn'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useTranslation } from '#i18n'
import NavLink from '@/app/components/app-sidebar/nav-link'
import ToggleButton from '@/app/components/app-sidebar/toggle-button'
import AppIcon from '@/app/components/base/app-icon'
import Divider from '@/app/components/base/divider'
import SidebarLeftArrowIcon from '@/app/components/base/icons/src/vender/SidebarLeftArrowIcon'
import { useSetGotoAnythingOpen } from '@/app/components/goto-anything/atoms'
import Link from '@/next/link'
import { usePathname, useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { getAgentDetailPath, getAgentIdFromPathname } from './routes'

type AgentDetailTopProps = {
  expand?: boolean
  onToggle?: () => void
}

type AgentDetailSectionProps = {
  expand?: boolean
}

type AgentDetailNavItem = {
  labelKey: `agentDetail.sections.${AgentDetailSectionKey}`
  href: string
  icon: NavIcon
  activeIcon: NavIcon
}

const SEARCH_SHORTCUT = ['Mod', 'K']

const createAgentNavIcon = (iconClassName: string) => {
  function AgentNavIcon({ className }: ComponentProps<'svg'>) {
    return <span aria-hidden className={cn(iconClassName, className)} />
  }

  return AgentNavIcon
}

const configureIcon = createAgentNavIcon('i-custom-vender-agent-v2-configure')
const configureActiveIcon = createAgentNavIcon('i-custom-vender-agent-v2-configure-active')
const accessPointIcon = createAgentNavIcon('i-custom-vender-agent-v2-access-point')
const fileListLineIcon = createAgentNavIcon('i-ri-file-list-3-line')
const fileListFillIcon = createAgentNavIcon('i-ri-file-list-3-fill')
const dashboardLineIcon = createAgentNavIcon('i-ri-dashboard-2-line')
const dashboardFillIcon = createAgentNavIcon('i-ri-dashboard-2-fill')

const getAgentDetailNavigation = (agentId: string): AgentDetailNavItem[] => [
  {
    labelKey: 'agentDetail.sections.configure',
    href: getAgentDetailPath(agentId, 'configure'),
    icon: configureIcon,
    activeIcon: configureActiveIcon,
  },
  {
    labelKey: 'agentDetail.sections.access',
    href: getAgentDetailPath(agentId, 'access'),
    icon: accessPointIcon,
    activeIcon: accessPointIcon,
  },
  {
    labelKey: 'agentDetail.sections.logs',
    href: getAgentDetailPath(agentId, 'logs'),
    icon: fileListLineIcon,
    activeIcon: fileListFillIcon,
  },
  {
    labelKey: 'agentDetail.sections.monitoring',
    href: getAgentDetailPath(agentId, 'monitoring'),
    icon: dashboardLineIcon,
    activeIcon: dashboardFillIcon,
  },
]

export function AgentDetailTop({
  expand = true,
  onToggle,
}: AgentDetailTopProps) {
  const { t: tApp } = useTranslation('app')
  const { t: tCommon } = useTranslation('common')
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
            aria-label={tCommon('operation.back')}
            className="flex size-4 items-center justify-center text-text-tertiary hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            onClick={() => router.back()}
          >
            <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
          </button>
          <Link
            href="/"
            aria-label={tCommon('mainNav.home')}
            className="flex size-4 items-center justify-center text-text-tertiary hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-custom-vender-main-nav-app-home size-4" />
          </Link>
        </div>
        <span className="shrink-0 system-md-regular text-text-quaternary">
          /
        </span>
        <Link href="/roster" className="shrink-0 truncate rounded-lg px-1.5 py-2 system-sm-semibold-uppercase text-text-secondary transition-colors hover:bg-background-default-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden">
          {tCommon('menus.roster')}
        </Link>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={(
            <button
              type="button"
              aria-label={tApp('gotoAnything.searchTitle')}
              className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              onClick={() => setGotoAnythingOpen(true)}
            >
              <span aria-hidden className="i-custom-vender-main-nav-quick-search size-4" />
            </button>
          )}
        />
        <TooltipContent placement="bottom" className="flex items-center gap-1 rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg p-1.5 system-xs-medium text-text-secondary shadow-lg backdrop-blur-[5px]">
          <span className="px-0.5">{tApp('gotoAnything.quickAction')}</span>
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

export function AgentDetailSection({
  expand = true,
}: AgentDetailSectionProps) {
  const { t } = useTranslation('agentV2')
  const pathname = usePathname()
  const agentId = getAgentIdFromPathname(pathname)
  const agentQuery = useQuery(consoleQuery.agent.byAgentId.get.queryOptions({
    input: agentId
      ? {
          params: {
            agent_id: agentId,
          },
        }
      : skipToken,
  }))

  if (!agentId)
    return null

  const navigation = getAgentDetailNavigation(agentId)
  const agent = agentQuery.data
  const imageUrl = (agent?.icon_type === 'image' || agent?.icon_type === 'link') ? agent.icon : undefined
  const iconType = (imageUrl ? 'image' : agent?.icon_type) as AgentIconType | null | undefined

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
      <div className={cn('py-2', expand && '-mx-1')}>
        <div className={cn(
          'flex h-13 items-center rounded-xl py-1.5 pr-2 pl-1.5',
          !expand && 'justify-center',
        )}
        >
          <div className={cn(
            'shrink-0',
            expand && 'mr-2',
          )}
          >
            <span aria-hidden>
              <AppIcon
                size="large"
                rounded
                iconType={iconType}
                icon={agent?.icon ?? undefined}
                background={agent?.icon_background}
                imageUrl={imageUrl}
              />
            </span>
          </div>
          <div className={cn('flex h-10 min-w-0 flex-1 flex-col justify-center', !expand && 'hidden')}>
            <div className="truncate system-md-semibold text-text-secondary">
              {agent?.name ?? t('agentDetail.title')}
            </div>
            <div className="truncate system-2xs-medium-uppercase text-text-tertiary">
              {agent?.role ?? t('agentDetail.type')}
            </div>
          </div>
        </div>
      </div>
      <div className={cn(expand ? 'px-3 py-0.5' : 'px-1 py-0.5')}>
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
      </div>
      <nav className={cn('flex flex-col gap-y-0.5 py-2', expand ? 'px-1' : 'px-3')} aria-label={t('agentDetail.navigationLabel')}>
        {navigation.map(item => (
          <NavLink
            key={item.href}
            mode={expand ? 'expand' : 'collapse'}
            iconMap={{ selected: item.activeIcon, normal: item.icon }}
            name={t(item.labelKey)}
            href={item.href}
            pathname={pathname}
          />
        ))}
      </nav>
    </div>
  )
}
