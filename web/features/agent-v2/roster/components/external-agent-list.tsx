'use client'

import type { ExternalAgentActionRequest } from './external-agent-actions'
import type { AppIconProps } from '@/app/components/base/app-icon'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import CornerLabel from '@/app/components/base/corner-label'
import { MAIN_NAV_APP_CARD_GRID_CLASS_NAME } from '@/app/components/main-nav/app-card-grid'
import { getExternalAgentOverviewPath } from '@/features/agent-v2/external-agent/routes'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { getAdjacentFocusTargets } from '@/utils/get-adjacent-focus-targets'

export type ExternalAgentListItem = {
  key: string
  name: string
  role: string
  description: string
  icon?: AppIconProps['icon']
  enabled: boolean
  connectedByMe: boolean
  createdAt: number
  updatedAt: number
  apps: readonly { id?: string; name: string; kind: 'workflow' | 'chatflow' }[]
}

type ExternalAgentListProps = {
  agents: readonly ExternalAgentListItem[]
  filtered: boolean
  onAction?: (request: ExternalAgentActionRequest) => void
}

function ExternalAgentCard({
  agent,
  onAction,
}: {
  agent: ExternalAgentListItem
  onAction: ExternalAgentListProps['onAction']
}) {
  const { t } = useTranslation(['agentRoster'])
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const nameId = useId()
  const descriptionId = useId()
  const statusId = useId()
  const itemRef = useRef<HTMLLIElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const requestAction = (kind: ExternalAgentActionRequest['kind']) => {
    onAction?.({
      kind,
      agent,
      trigger: menuTriggerRef.current,
      adjacentFocusTargets: getAdjacentFocusTargets(itemRef.current, (sibling) =>
        sibling.querySelector<HTMLAnchorElement>(':scope > a[href]'),
      ),
    })
  }

  return (
    <li
      ref={itemRef}
      aria-labelledby={nameId}
      className={cn(
        'group relative flex h-36.5 min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-shadow focus-within:bg-components-card-bg-alt hover:bg-components-card-bg-alt hover:shadow-md has-data-popup-open:bg-components-card-bg-alt has-data-popup-open:shadow-md motion-reduce:transition-none',
        !agent.enabled && 'opacity-60',
      )}
    >
      <Link
        href={getExternalAgentOverviewPath(agent.key)}
        aria-labelledby={nameId}
        aria-describedby={`${descriptionId}${agent.enabled ? '' : ` ${statusId}`}`}
        className="flex min-h-0 flex-1 flex-col rounded-t-xl text-start outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
      >
        <div className="flex w-full items-center gap-3 ps-3.5 pe-4 pt-3.5 pb-2">
          <AppIcon
            size="xl"
            icon={agent.icon}
            fallback={{
              content: <span className="i-ri-robot-2-line size-7 text-text-tertiary" />,
              background: 'var(--color-text-primary-on-surface)',
            }}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
            <h2 id={nameId} className="truncate system-md-semibold text-text-secondary">
              {agent.name}
            </h2>
            <p className="truncate system-xs-regular text-text-tertiary">{agent.role}</p>
          </div>
        </div>
        <div className="w-full px-4 py-1 system-xs-regular text-text-tertiary">
          <p id={descriptionId} className="line-clamp-2 min-h-8">
            {agent.description}
          </p>
        </div>
      </Link>
      {!agent.enabled && (
        <span id={statusId} className="pointer-events-none absolute inset-e-0 top-[-0.5px]">
          <CornerLabel
            label={t(($) => $['external.filters.disabled'])}
            cornerClassName="rtl:-scale-x-100"
          />
        </span>
      )}
      {onAction && (
        <div className="pointer-events-none absolute inset-e-[-0.5px] top-[-0.5px] flex h-16 w-30 items-start justify-end bg-[linear-gradient(67deg,var(--color-components-card-bg-alt-transparent)_0%,var(--color-components-card-bg-alt)_75%)] p-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-data-popup-open:opacity-100 rtl:bg-[linear-gradient(293deg,var(--color-components-card-bg-alt-transparent)_0%,var(--color-components-card-bg-alt)_75%)] [@media(hover:none)]:opacity-100">
          <div className="pointer-events-none rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-xs group-focus-within:pointer-events-auto group-hover:pointer-events-auto has-data-popup-open:pointer-events-auto [@media(hover:none)]:pointer-events-auto">
            <Menu modal={false}>
              <MenuTrigger
                render={
                  <IconButton
                    ref={menuTriggerRef}
                    size="lg"
                    aria-label={t(($) => $['roster.moreActions'], { name: agent.name })}
                    className="data-popup-open:bg-state-base-hover"
                  >
                    <span aria-hidden className="i-ri-more-fill size-4.5" />
                  </IconButton>
                }
              />
              <MenuContent align="end" className="min-w-40">
                <MenuItem className="gap-2" onClick={() => requestAction('edit')}>
                  <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
                  {t(($) => $['external.editInfo'])}
                </MenuItem>
                <MenuItem className="gap-2" onClick={() => requestAction('toggle')}>
                  <span
                    aria-hidden
                    className={cn(
                      'size-4 text-text-tertiary',
                      agent.enabled ? 'i-ri-pause-circle-line' : 'i-ri-play-circle-line',
                    )}
                  />
                  {agent.enabled ? t(($) => $['external.disable']) : t(($) => $['external.enable'])}
                </MenuItem>
                <MenuSeparator />
                <MenuItem className="gap-2" onClick={() => requestAction('delete')}>
                  <span aria-hidden className="i-ri-delete-bin-line size-4 text-text-tertiary" />
                  {t(($) => $['external.delete'])}
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
      )}
      <div className="flex h-9 min-w-0 shrink-0 items-center gap-1.5 ps-4 pe-3 pt-2 pb-3 system-xs-regular text-text-tertiary">
        <Popover>
          <PopoverTrigger className="-m-1 flex h-6 shrink-0 items-center gap-1 rounded-md p-1 hover:bg-state-base-hover data-popup-open:bg-state-base-hover">
            <span className="sr-only">
              {t(($) => $['external.references'], { name: agent.name })}:{' '}
            </span>
            <span aria-hidden className="i-custom-vender-agent-v2-plan size-3" />
            <span>{t(($) => $['external.appsCount'], { count: agent.apps.length })}</span>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-66 max-w-[calc(100vw-2rem)] p-1">
            <PopoverTitle className="px-3 pt-2 pb-1.5 system-xs-medium text-text-tertiary">
              {t(($) => $['external.references'], { name: agent.name })}
            </PopoverTitle>
            <ul>
              {agent.apps.map((app) => (
                <li
                  key={app.id ?? app.name}
                  className="flex min-w-0 items-center gap-2 px-3 py-2 system-sm-regular text-text-secondary"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-4 shrink-0 text-text-tertiary',
                      app.kind === 'workflow' ? 'i-ri-flow-chart' : 'i-ri-chat-3-line',
                    )}
                  />
                  <span className="min-w-0 wrap-break-word">{app.name}</span>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
        <span aria-hidden className="text-text-quaternary">
          ·
        </span>
        <span className="min-w-0 truncate">
          {t(($) => $['external.updated'], { time: formatTimeFromNow(agent.updatedAt) })}
        </span>
      </div>
    </li>
  )
}

export function ExternalAgentList({ agents, filtered, onAction }: ExternalAgentListProps) {
  const { t } = useTranslation(['agentRoster'])

  return (
    <ScrollArea className="h-full">
      <ScrollAreaViewport className="h-full" aria-label={t(($) => $['roster.tabs.external'])}>
        <ScrollAreaContent className="px-2 pt-2 pb-4 sm:px-8">
          {agents.length > 0 ? (
            <ul
              aria-label={t(($) => $['roster.listLabel'])}
              className={cn(MAIN_NAV_APP_CARD_GRID_CLASS_NAME, 'gap-2.5')}
            >
              {agents.map((agent) => (
                <ExternalAgentCard key={agent.key} agent={agent} onAction={onAction} />
              ))}
            </ul>
          ) : (
            <div
              role="status"
              className="flex min-h-64 flex-col items-center justify-center gap-3 text-text-tertiary"
            >
              <span
                aria-hidden
                className="flex size-14 items-center justify-center rounded-xl border border-dashed border-divider-regular bg-components-card-bg"
              >
                <span className="i-ri-robot-2-line size-6" />
              </span>
              <p className="system-sm-regular">
                {filtered ? t(($) => $['external.emptySearch']) : t(($) => $['external.empty'])}
              </p>
            </div>
          )}
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar>
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollArea>
  )
}
