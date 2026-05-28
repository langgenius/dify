'use client'

import type { AgentDetailSectionKey } from './section'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { GOTO_ANYTHING_OPEN_EVENT } from '@/app/components/goto-anything/hooks'
import Link from '@/next/link'
import { usePathname, useRouter } from '@/next/navigation'
import { getAgentDetailPath, getAgentIdFromPathname } from './routes'

type AgentDetailNavItem = {
  labelKey: `agentDetail.sections.${AgentDetailSectionKey}`
  href: string
  icon: string
  activeIcon: string
}

const getAgentDetailNavigation = (agentId: string): AgentDetailNavItem[] => [
  {
    labelKey: 'agentDetail.sections.configure',
    href: getAgentDetailPath(agentId, 'configure'),
    icon: 'i-ri-node-tree',
    activeIcon: 'i-ri-node-tree',
  },
  {
    labelKey: 'agentDetail.sections.access',
    href: getAgentDetailPath(agentId, 'access'),
    icon: 'i-ri-share-forward-line',
    activeIcon: 'i-ri-share-forward-fill',
  },
  {
    labelKey: 'agentDetail.sections.logs',
    href: getAgentDetailPath(agentId, 'logs'),
    icon: 'i-ri-list-check-2',
    activeIcon: 'i-ri-list-check-2',
  },
  {
    labelKey: 'agentDetail.sections.monitoring',
    href: getAgentDetailPath(agentId, 'monitoring'),
    icon: 'i-ri-pulse-line',
    activeIcon: 'i-ri-pulse-fill',
  },
]

export function AgentDetailTop() {
  const { t } = useTranslation()
  const router = useRouter()

  return (
    <div className="flex items-center py-3 pr-3 pl-1">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <div className="flex shrink-0 items-center py-1 pr-1 pl-0.5">
          <button
            type="button"
            aria-label={t('operation.back', { ns: 'common' })}
            className="flex size-4 items-center justify-center rounded-sm text-text-tertiary hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            onClick={() => router.back()}
          >
            <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
          </button>
          <Link
            href="/"
            aria-label={t('mainNav.home', { ns: 'common' })}
            className="flex size-4 items-center justify-center rounded-sm text-text-tertiary hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-custom-vender-main-nav-app-home size-4" />
          </Link>
        </div>
        <span className="mx-1.5 shrink-0 system-md-regular text-text-quaternary">
          /
        </span>
        <Link href="/roster" className="shrink-0 truncate rounded-sm system-sm-semibold-uppercase text-text-secondary hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden">
          {t('menus.roster', { ns: 'common' })}
        </Link>
      </div>
      <button
        type="button"
        aria-label={t('gotoAnything.searchTitle', { ns: 'app' })}
        className="flex shrink-0 items-center gap-1 overflow-hidden rounded-[10px] p-1 text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        onClick={() => window.dispatchEvent(new Event(GOTO_ANYTHING_OPEN_EVENT))}
      >
        <span aria-hidden className="i-custom-vender-main-nav-quick-search size-4" />
        <span className="rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
          ⌘K
        </span>
      </button>
    </div>
  )
}

export function AgentDetailSection() {
  const { t } = useTranslation('agentV2')
  const pathname = usePathname()
  const agentId = getAgentIdFromPathname(pathname)

  if (!agentId)
    return null

  const navigation = getAgentDetailNavigation(agentId)

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
      <div className="py-2">
        <div className="flex items-center rounded-xl p-2">
          <div className="mr-2 flex size-8 shrink-0 items-center justify-center rounded-lg bg-text-accent text-text-primary-on-surface shadow-xs">
            <span aria-hidden className="i-custom-vender-solid-mediaAndDevices-robot size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate system-md-semibold text-text-secondary">
              {t('agentDetail.title')}
            </div>
            <div className="system-2xs-medium-uppercase text-text-tertiary">
              {t('agentDetail.type')}
            </div>
          </div>
        </div>
      </div>
      <div className="px-2 py-2">
        <div className="h-px bg-linear-to-r from-divider-subtle to-background-gradient-mask-transparent" />
      </div>
      <nav className="flex flex-col gap-y-0.5 px-1 py-2" aria-label={t('agentDetail.navigationLabel')}>
        {navigation.map((item) => {
          const isActive = pathname === item.href
          const icon = isActive ? item.activeIcon : item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center rounded-lg border-t-[0.75px] border-r-[0.25px] border-b-[0.25px] border-l-[0.75px] pr-1 pl-3',
                isActive
                  ? 'border-effects-highlight-lightmode-off bg-components-menu-item-bg-active system-sm-semibold text-text-accent-light-mode-only'
                  : 'border-transparent system-sm-medium text-components-menu-item-text hover:bg-components-menu-item-bg-hover hover:text-components-menu-item-text-hover',
                'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
              )}
            >
              <span aria-hidden className={`${icon} size-4 shrink-0`} />
              <span className="ml-2 overflow-hidden whitespace-nowrap">
                {t(item.labelKey)}
              </span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
