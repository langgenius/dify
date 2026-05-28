'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'

const rosterItems = [
  {
    id: 'iris',
    name: 'Iris',
    role: 'Clarification Drafter',
    description: 'Go through supplier clarification questions based on list of tenders',
    version: 'v5',
    model: 'claude-opus-4.7',
    workflowUsage: '4',
    updatedAt: '2d',
    colorClassName: 'from-[#6C3CF6] to-[#4B2DDB]',
    tool: 'tender-analyze',
  },
  {
    id: 'nadia',
    name: 'Nadia',
    role: 'Compliance Reviewer',
    description: 'Checks tender responses against mandatory requirements and red flags',
    version: 'v3',
    model: 'claude-opus-4.7',
    workflowUsage: '4',
    updatedAt: '6d',
    colorClassName: 'from-[#D4479B] to-[#B93685]',
    tool: 'compliance-che',
  },
  {
    id: 'marko',
    name: 'Marko',
    role: 'Pricing Analyst',
    description: 'Normalizes supplier pricing across currencies and payment terms',
    version: 'v3',
    model: 'claude-sonnet-4.7',
    workflowUsage: '0',
    updatedAt: '11d',
    colorClassName: 'from-[#F59E0B] to-[#D97706]',
    tool: 'fx-normalizer',
  },
  {
    id: 'aiko',
    name: 'Aiko',
    role: 'Document Translator',
    description: 'Translates supplier responses into the tender language for evaluators',
    version: 'v2',
    model: 'claude-haiku-4.5',
    workflowUsage: '0',
    updatedAt: '1mo',
    colorClassName: 'from-[#4BA9C9] to-[#2A7F9E]',
    tool: 'multilingual-t',
    draft: true,
  },
]

const rosterNavItems = [
  { labelKey: 'roster.sidebar.agents', count: 4, icon: 'i-custom-vender-solid-mediaAndDevices-robot' },
  { labelKey: 'roster.sidebar.humans', count: 8, icon: 'i-ri-group-line' },
] as const

const filterItems = [
  'roster.filters.all',
  'roster.filters.inUse',
  'roster.filters.drafts',
] as const

export default function RosterPage() {
  const { t } = useTranslation()
  const { t: tAgentV2 } = useTranslation('agentV2')

  useDocumentTitle(t('menus.roster', { ns: 'common' }))

  return (
    <main className="flex h-full min-w-0 overflow-hidden bg-background-section">
      <aside className="flex w-62 shrink-0 flex-col border-r border-divider-subtle bg-background-body px-3 py-6">
        <h1 className="px-2 title-2xl-semi-bold text-text-primary">
          {t('menus.roster', { ns: 'common' })}
        </h1>
        <nav className="mt-5 space-y-1" aria-label={tAgentV2('roster.sidebarLabel')}>
          {rosterNavItems.map((item, index) => {
            const active = index === 0

            return (
              <button
                key={item.labelKey}
                type="button"
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex h-11 w-full items-center gap-2 rounded-xl px-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
                  active
                    ? 'bg-state-accent-hover text-text-accent'
                    : 'text-text-secondary hover:bg-state-base-hover',
                ].join(' ')}
              >
                <span aria-hidden className={`${item.icon} size-4 shrink-0`} />
                <span className="min-w-0 flex-1 truncate system-sm-semibold">
                  {tAgentV2(item.labelKey)}
                </span>
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-components-badge-bg-dimm px-1.5 system-xs-medium text-text-tertiary">
                  {item.count}
                </span>
              </button>
            )
          })}
        </nav>
        <div className="mt-auto rounded-xl border border-components-panel-border bg-components-panel-on-panel-item-bg px-5 py-4 text-center shadow-xs">
          <div className="mx-auto mb-2 flex w-fit -space-x-2">
            {['N', 'M', 'A'].map(initial => (
              <span key={initial} className="flex size-6 items-center justify-center rounded-full border border-components-panel-on-panel-item-bg bg-text-accent system-xs-semibold text-text-primary-on-surface">
                {initial}
              </span>
            ))}
          </div>
          <p className="system-xs-medium text-text-tertiary">
            {tAgentV2('roster.marketplaceCta')}
          </p>
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-auto px-8 py-8">
        <header className="max-w-5xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="title-2xl-semi-bold text-text-primary">
              {tAgentV2('roster.title')}
            </h2>
            <a
              href="https://docs.dify.ai/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md system-xs-semibold text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              {tAgentV2('roster.learnMore')}
              <span aria-hidden className="i-ri-arrow-right-up-line size-3" />
            </a>
          </div>
          <p className="mt-3 max-w-3xl system-sm-regular text-text-tertiary">
            {tAgentV2('roster.description')}
          </p>
        </header>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-divider-subtle pt-6">
          <label className="relative block w-82 max-w-full">
            <span className="sr-only">{tAgentV2('roster.searchLabel')}</span>
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 i-ri-search-line size-4 -translate-y-1/2 text-text-tertiary" />
            <input
              type="search"
              name="agent-search"
              autoComplete="off"
              readOnly
              className="h-9 w-full rounded-lg border border-components-panel-border bg-components-input-bg-normal pr-3 pl-9 system-sm-regular text-text-secondary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              placeholder={tAgentV2('roster.searchPlaceholder')}
            />
          </label>
          <div className="flex h-9 items-center rounded-lg border border-components-panel-border bg-components-panel-on-panel-item-bg p-0.5 shadow-xs">
            {filterItems.map((filter, index) => (
              <button
                key={filter}
                type="button"
                aria-pressed={index === 0}
                className={[
                  'h-8 rounded-md px-3 system-sm-semibold transition-colors focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
                  index === 0
                    ? 'bg-state-base-hover text-text-secondary shadow-xs'
                    : 'text-text-tertiary hover:text-text-secondary',
                ].join(' ')}
              >
                {tAgentV2(filter)}
              </button>
            ))}
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <Button className="gap-1.5" disabled>
              <span aria-hidden className="i-custom-vender-solid-mediaAndDevices-robot size-4" />
              {tAgentV2('roster.connectOwnAgent')}
              <span className="rounded bg-components-badge-bg-dimm px-1 system-2xs-semibold-uppercase text-text-tertiary">
                {tAgentV2('roster.soon')}
              </span>
            </Button>
            <Button variant="primary" className="min-w-40 gap-1.5" disabled>
              <span aria-hidden className="i-ri-add-line size-4" />
              {tAgentV2('roster.createAgent')}
            </Button>
            <Button className="px-2.5" aria-label={tAgentV2('roster.listView')}>
              <span aria-hidden className="i-ri-list-unordered size-4" />
            </Button>
            <Button className="px-2.5" aria-label={tAgentV2('roster.gridView')}>
              <span aria-hidden className="i-ri-grid-line size-4" />
            </Button>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {rosterItems.map(item => (
            <article
              key={item.id}
              className={[
                'flex min-h-19 min-w-0 items-center gap-4 rounded-xl border bg-components-panel-on-panel-item-bg px-4 py-3 shadow-xs',
                item.draft
                  ? 'border-text-warning/35 bg-util-colors-warning-warning-50/40'
                  : 'border-components-panel-border',
              ].join(' ')}
            >
              <div className={`flex size-12 shrink-0 items-center justify-center rounded-full bg-linear-to-br ${item.colorClassName} text-text-primary-on-surface shadow-xs ring-2 ring-components-panel-on-panel-item-bg`}>
                <span aria-hidden className="i-custom-vender-solid-mediaAndDevices-robot size-5" />
              </div>
              <div className="min-w-65 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <h3 className="truncate system-md-semibold text-text-primary">
                    {item.name}
                    {' '}
                    -
                    {' '}
                    {item.role}
                  </h3>
                  <span className="shrink-0 system-xs-regular text-text-tertiary">{item.version}</span>
                  {item.draft && (
                    <span className="shrink-0 rounded border border-text-warning/40 bg-util-colors-warning-warning-50 px-1.5 system-2xs-semibold-uppercase text-text-warning">
                      {tAgentV2('roster.draft')}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate system-sm-regular text-text-tertiary">
                  {item.description}
                </p>
              </div>
              <div className="hidden min-w-44 items-center gap-2 xl:flex">
                <span aria-hidden className="i-ri-sparkling-line size-3.5 text-text-tertiary" />
                <span className="code-sm-regular text-text-secondary">{item.model}</span>
              </div>
              <div className="hidden min-w-37 items-center gap-2 2xl:flex">
                <span className="rounded-md border border-util-colors-violet-violet-200 bg-util-colors-violet-violet-50 px-2 py-1 code-sm-semibold text-util-colors-violet-violet-700">
                  {item.tool}
                </span>
              </div>
              <div className="hidden w-35.5 shrink-0 text-right system-xs-regular text-text-tertiary lg:block">
                {Number(item.workflowUsage) > 0
                  ? tAgentV2('roster.usedInWorkflows', { count: Number(item.workflowUsage) })
                  : tAgentV2('roster.unused')}
                <div>{tAgentV2('roster.updated', { time: item.updatedAt })}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/roster/${item.id}/configure`}
                  aria-label={tAgentV2('roster.editAgent', { name: item.name })}
                  className={cn(
                    'inline-flex h-6 items-center justify-center gap-1 rounded-md border border-components-button-secondary-border bg-components-button-secondary-bg px-2 text-xs font-medium text-components-button-secondary-text shadow-xs backdrop-blur-[5px]',
                    'hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover',
                    'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
                  )}
                >
                  <span aria-hidden className="i-ri-edit-line size-3.5" />
                  {t('operation.edit', { ns: 'common' })}
                </Link>
                <Button
                  size="small"
                  variant="secondary-accent"
                  className="gap-1"
                  aria-label={tAgentV2('roster.inviteAgent', { name: item.name })}
                  disabled
                >
                  <span aria-hidden className="i-ri-add-circle-fill size-3.5" />
                  {tAgentV2('roster.invite')}
                </Button>
                <Button size="small" className="px-1.5" aria-label={tAgentV2('roster.moreActions', { name: item.name })}>
                  <span aria-hidden className="i-ri-more-fill size-4" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
