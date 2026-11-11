'use client'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@langgenius/dify-ui/breadcrumb'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Separator } from '@langgenius/dify-ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import NavLink from '@/app/components/app-sidebar/nav-link'
import AppIcon from '@/app/components/base/app-icon'
import { DetailSidebarFrame } from '@/app/components/detail-sidebar'
import { DetailSidebarToggleButton } from '@/app/components/detail-sidebar/toggle-button'
import { gotoAnythingDialogHandle } from '@/app/components/goto-anything/handles'
import { GOTO_ANYTHING_HOTKEY } from '@/app/components/goto-anything/hotkeys'
import Link from '@/next/link'
import { usePathname } from '@/next/navigation'
import { ExternalAgentManageMenu } from './manage-menu'
import { getExternalAgentMonitoringPath, getExternalAgentOverviewPath } from './routes'
import { useExternalAgentPreview } from './state'

function ExternalAgentTop({ expand, onToggle }: { expand: boolean; onToggle: () => void }) {
  const { t } = useTranslation(['agentRoster', 'navigation', 'app'])
  const toggle = (
    <DetailSidebarToggleButton
      expand={expand}
      onToggle={onToggle}
      icon={<span aria-hidden className="i-custom-vender-line-arrows-sidebar-left-arrow size-4" />}
    />
  )

  if (!expand) {
    return <div className="flex w-full items-center justify-center px-3 pt-2 pb-1">{toggle}</div>
  }

  return (
    <div className="flex items-center py-2 ps-1 pe-2">
      <Breadcrumb aria-label={t(($) => $['roster.title'])} className="flex-1">
        <BreadcrumbList className="gap-px">
          <BreadcrumbItem className="shrink-0">
            <BreadcrumbLink
              render={<Link href="/" />}
              aria-label={t(($) => $['mainNav.home'], { ns: 'navigation' })}
              className="gap-0 rounded-lg py-2 ps-0.5 pe-1.5 hover:bg-background-default-hover"
            >
              <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
              <span aria-hidden className="i-custom-vender-main-nav-app-home size-4" />
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="system-md-regular" />
          <BreadcrumbItem className="shrink-0">
            <BreadcrumbLink
              render={<Link href="/agents?agent_type=external" />}
              className="rounded-lg px-1.5 py-2 system-sm-semibold-uppercase text-text-secondary hover:bg-background-default-hover hover:text-text-primary"
            >
              {t(($) => $['roster.title'])}
            </BreadcrumbLink>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              handle={gotoAnythingDialogHandle}
              render={
                <IconButton
                  size="lg"
                  aria-label={t(($) => $['gotoAnything.searchTitle'], { ns: 'app' })}
                  className="shrink-0 rounded-[10px] transition-colors"
                >
                  <span aria-hidden className="i-custom-vender-main-nav-quick-search size-4" />
                </IconButton>
              }
            />
          }
        />
        <TooltipContent side="bottom" className="flex items-center gap-1">
          <span className="px-0.5">{t(($) => $['gotoAnything.quickAction'], { ns: 'app' })}</span>
          <KbdGroup>
            {formatForDisplay(GOTO_ANYTHING_HOTKEY, { parts: true }).map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </KbdGroup>
        </TooltipContent>
      </Tooltip>
      {toggle}
    </div>
  )
}

function ExternalAgentSection({ agentId, expand }: { agentId: string; expand: boolean }) {
  const { t } = useTranslation(['agentRoster'])
  const { preview, updatePreview } = useExternalAgentPreview(agentId)
  const pathname = usePathname()
  const { agent } = preview

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-2">
      <div className={cn('flex items-center gap-2 px-3 py-3', !expand && 'justify-center px-2')}>
        <AppIcon
          size="medium"
          shape="circle"
          icon={agent.icon}
          fallback={{
            content: <span className="i-ri-robot-2-line size-5 text-text-tertiary" />,
            background: 'var(--color-components-icon-bg-midnight-soft)',
          }}
        />
        <div className={cn('relative min-w-0 flex-1 pe-6', !expand && 'hidden')}>
          <div className="truncate system-md-semibold text-text-secondary">{agent.name}</div>
          <div className="mt-0.5 system-2xs-medium-uppercase text-text-tertiary">
            {t(($) => $['external.overview.type'])}
          </div>
          <div className="absolute inset-e-0 -top-1">
            <ExternalAgentManageMenu
              agent={agent}
              onUpdate={(agent) => updatePreview({ agent })}
              compact
            />
          </div>
        </div>
      </div>
      <div className={cn('py-0.5', expand ? 'px-5' : 'px-3')}>
        <Separator
          decorative
          orientation="horizontal"
          variant={expand ? 'gradient' : 'solid'}
          className={cn('my-0', expand ? 'from-divider-subtle' : 'bg-divider-subtle')}
        />
      </div>
      <nav
        aria-label={t(($) => $['roster.tabs.external'])}
        className="flex flex-col gap-y-0.5 px-3 py-2"
      >
        <NavLink
          name={t(($) => $['external.overview.title'])}
          href={getExternalAgentOverviewPath(agentId)}
          pathname={pathname}
          mode={expand ? 'expand' : 'collapse'}
          iconMap={{ selected: 'i-ri-function-line', normal: 'i-ri-function-line' }}
        />
        <NavLink
          name={t(($) => $['external.overview.monitoring'])}
          href={getExternalAgentMonitoringPath(agentId)}
          pathname={pathname}
          mode={expand ? 'expand' : 'collapse'}
          iconMap={{ selected: 'i-ri-equalizer-2-line', normal: 'i-ri-equalizer-2-line' }}
        />
      </nav>
    </div>
  )
}

export function ExternalAgentDetailSidebar({ agentId }: { agentId: string }) {
  return (
    <DetailSidebarFrame
      renderTop={({ expand, onToggle }) => <ExternalAgentTop expand={expand} onToggle={onToggle} />}
      renderSection={({ expand }) => <ExternalAgentSection agentId={agentId} expand={expand} />}
    />
  )
}
