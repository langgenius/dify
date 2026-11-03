'use client'

import type { AppIconProps } from '@/app/components/base/app-icon'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import CornerLabel from '@/app/components/base/corner-label'
import { MAIN_NAV_APP_CARD_GRID_CLASS_NAME } from '@/app/components/main-nav/app-card-grid'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'

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
  apps: readonly { name: string; kind: 'workflow' | 'chatflow' }[]
}

type ExternalAgentListProps = {
  agents: readonly ExternalAgentListItem[]
  filtered: boolean
}

function ExternalAgentCard({ agent }: { agent: ExternalAgentListItem }) {
  const { t } = useTranslation(['agentRoster'])
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const nameId = useId()
  const descriptionId = useId()
  const statusId = useId()

  return (
    <li
      aria-labelledby={nameId}
      className={cn(
        'group relative flex h-36.5 min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-shadow hover:bg-components-card-bg-alt hover:shadow-md motion-reduce:transition-none',
        !agent.enabled && 'opacity-60',
      )}
    >
      <Popover>
        <PopoverTrigger
          aria-labelledby={nameId}
          aria-describedby={`${descriptionId}${agent.enabled ? '' : ` ${statusId}`}`}
          className="flex min-h-0 flex-1 flex-col rounded-t-xl text-start focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
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
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-4">
          <PopoverTitle className="system-md-semibold wrap-break-word text-text-primary">
            {agent.name}
          </PopoverTitle>
          <p className="mt-1 system-xs-regular wrap-break-word text-text-tertiary">{agent.role}</p>
          <PopoverDescription className="mt-3 system-sm-regular wrap-break-word text-text-secondary">
            {agent.description}
          </PopoverDescription>
        </PopoverContent>
      </Popover>
      {!agent.enabled && (
        <span id={statusId} className="pointer-events-none absolute inset-e-0 top-[-0.5px]">
          <CornerLabel
            label={t(($) => $['external.filters.disabled'])}
            cornerClassName="rtl:-scale-x-100"
          />
        </span>
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
                  key={app.name}
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

export function ExternalAgentList({ agents, filtered }: ExternalAgentListProps) {
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
                <ExternalAgentCard key={agent.key} agent={agent} />
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
