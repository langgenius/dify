'use client'

import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useQueryState } from 'nuqs'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import useDocumentTitle from '@/hooks/use-document-title'
import { DifyRoster } from './dify-roster'
import { ExternalRoster } from './external-roster'
import { rosterQueryParamNames, rosterTypeQueryParser } from './query-params'

export default function RosterPage() {
  const { t } = useTranslation(['agentRoster'])
  const docLink = useDocLink()
  const [type, setType] = useQueryState(rosterQueryParamNames.type, rosterTypeQueryParser)
  const titleId = useId()
  const title = t(($) => $['roster.title'])
  useDocumentTitle(title)

  return (
    <Tabs
      value={type}
      onValueChange={(value) => void setType(value)}
      className="flex h-0 min-w-0 grow flex-col overflow-hidden bg-background-body max-md:overflow-y-auto"
    >
      <div className="shrink-0 px-2 pt-4 sm:px-8">
        <div className="flex h-6 min-w-0 items-center justify-between gap-2 sm:gap-4">
          <h1
            id={titleId}
            title={title}
            className="min-w-0 flex-1 truncate text-[18px]/[21.6px] font-semibold text-text-primary"
          >
            {title}
          </h1>
          <a
            href={docLink('/use-dify/build/new-agent/overview')}
            target="_blank"
            rel="noreferrer"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md system-xs-regular text-text-tertiary hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden sm:size-auto sm:gap-0.5"
          >
            <span className="sr-only sm:not-sr-only">{t(($) => $['roster.learnMore'])}</span>
            <span aria-hidden className="i-ri-book-open-line size-4 sm:hidden" />
            <span
              aria-hidden
              className="i-ri-external-link-line hidden size-3 sm:inline-block [&:dir(rtl)]:-scale-x-100"
            />
          </a>
        </div>
        <TabsList
          aria-label={t(($) => $['roster.tabs.label'])}
          className="mt-3.5 border-b border-components-panel-border-subtle"
        >
          <TabsTab value="dify" className="py-2 text-[13px]/4 uppercase">
            {t(($) => $['roster.tabs.dify'])}
          </TabsTab>
          <TabsTab value="external" className="py-2 text-[13px]/4 uppercase">
            {t(($) => $['roster.tabs.external'])}
          </TabsTab>
        </TabsList>
      </div>
      <TabsPanel value="dify" className="flex min-h-0 flex-1 flex-col">
        {type === 'dify' && <DifyRoster labelledBy={titleId} />}
      </TabsPanel>
      <TabsPanel value="external" className="flex min-h-0 flex-1 flex-col">
        {type === 'external' && <ExternalRoster />}
      </TabsPanel>
    </Tabs>
  )
}
