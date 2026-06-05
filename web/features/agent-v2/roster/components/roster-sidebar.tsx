'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

type RosterSidebarProps = {
  totalAgents: number
}

export function RosterSidebar({ totalAgents }: RosterSidebarProps) {
  const { t } = useTranslation('agentV2')

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-divider-subtle bg-background-body px-3 py-4 md:flex">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-2 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-text-accent text-text-primary-on-surface shadow-xs">
              <span aria-hidden className="i-custom-vender-solid-mediaAndDevices-robot size-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate system-md-semibold text-text-secondary">
                {t('roster.title')}
              </div>
              <div className="system-2xs-medium-uppercase text-text-tertiary">
                {t('roster.sidebarLabel')}
              </div>
            </div>
          </div>
        </div>
        <div className="px-2 py-2">
          <div className="h-px bg-linear-to-r from-divider-subtle to-background-gradient-mask-transparent" />
        </div>
        <nav className="flex flex-col gap-y-0.5 px-1 py-2" aria-label={t('roster.sidebarLabel')}>
          <div
            aria-current="page"
            className="flex h-8 items-center rounded-lg border-t-[0.75px] border-r-[0.25px] border-b-[0.25px] border-l-[0.75px] border-effects-highlight-lightmode-off bg-components-menu-item-bg-active pr-1 pl-3 system-sm-semibold text-text-accent-light-mode-only"
          >
            <span aria-hidden className="i-custom-vender-solid-mediaAndDevices-robot size-4 shrink-0" />
            <span className="ml-2 min-w-0 flex-1 truncate">
              {t('roster.sidebar.agents')}
            </span>
            <span className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
              {totalAgents}
            </span>
          </div>
          <button
            type="button"
            disabled
            className={cn(
              'flex h-8 items-center rounded-lg border-t-[0.75px] border-r-[0.25px] border-b-[0.25px] border-l-[0.75px] border-transparent pr-1 pl-3 text-left system-sm-medium text-text-disabled',
              'cursor-not-allowed',
            )}
          >
            <span aria-hidden className="i-ri-user-smile-line size-4 shrink-0" />
            <span className="ml-2 min-w-0 flex-1 truncate">
              {t('roster.sidebar.humans')}
            </span>
            <span className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
              {t('roster.sidebar.soon')}
            </span>
          </button>
        </nav>
      </div>
    </aside>
  )
}
