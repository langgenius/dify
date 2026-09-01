'use client'

import type { KnowledgeFsOverviewInventoryResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { compactNumber } from './overview-format'
import { EmptyInline, OverviewErrorInline, Panel, Skeleton } from './overview-panel'
import {
  overviewInventoryDataAtom,
  overviewInventoryErrorAtom,
  overviewInventoryPendingAtom,
  overviewShowEmptyModulesAtom,
  overviewShowIndexingAtom,
} from './state'

export function InventoryPanel() {
  const { t } = useTranslation('dataset')
  const empty = useAtomValue(overviewShowEmptyModulesAtom)
  const error = useAtomValue(overviewInventoryErrorAtom)
  const indexing = useAtomValue(overviewShowIndexingAtom)
  const inventory: KnowledgeFsOverviewInventoryResponse | undefined =
    useAtomValue(overviewInventoryDataAtom)
  const loading = useAtomValue(overviewInventoryPendingAtom)
  const categories = inventory
    ? [
        {
          color: 'bg-util-colors-blue-blue-500',
          segment: 'border-util-colors-blue-blue-500 bg-util-colors-blue-blue-100',
          label: t(($) => $['newKnowledge.overview.webCrawl']),
          value: inventory.source_categories.crawl,
        },
        {
          color: 'bg-util-colors-green-green-500',
          segment: 'border-util-colors-green-green-500 bg-util-colors-green-green-100',
          label: t(($) => $['newKnowledge.overview.onlineDocuments']),
          value: inventory.source_categories.online_documents,
        },
        {
          color: 'bg-util-colors-purple-purple-500',
          segment: 'border-util-colors-purple-purple-500 bg-util-colors-purple-purple-100',
          label: t(($) => $['newKnowledge.overview.onlineDrives']),
          value: inventory.source_categories.online_drives,
        },
        {
          color: 'bg-util-colors-orange-orange-500',
          segment: 'border-util-colors-orange-orange-500 bg-util-colors-orange-orange-50',
          label: t(($) => $['newKnowledge.overview.uploads']),
          value: inventory.source_categories.uploads,
        },
      ]
    : []
  const categoryTotal = categories.reduce((total, category) => total + category.value, 0)
  const visibleCategories = categories.filter((category) => category.value > 0)

  if (error)
    return (
      <section className="flex h-68.75 min-w-0 flex-col gap-2 pt-6">
        <h2 className="text-[15px] leading-6 font-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.inventory'])}
        </h2>
        <Panel className="flex h-54.75 border border-components-panel-border p-4 shadow-none">
          <OverviewErrorInline />
        </Panel>
      </section>
    )

  if (empty)
    return (
      <section className={cn('flex min-w-0 flex-col gap-2 pt-6', indexing ? 'h-65' : 'h-68.75')}>
        <h2 className="text-[15px] leading-6 font-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.inventory'])}
        </h2>
        <Panel
          className={cn(
            'flex border border-components-panel-border p-4 shadow-none',
            indexing ? 'h-51' : 'h-54.75',
          )}
        >
          <EmptyInline
            icon="i-ri-file-text-line"
            title={
              indexing
                ? t(($) => $['newKnowledge.overview.indexingInProgress'])
                : t(($) => $['newKnowledge.documentsEmptyTitle'])
            }
            description={
              indexing
                ? t(($) => $['newKnowledge.overview.indexingInProgressDescription'])
                : t(($) => $['newKnowledge.documentsEmptyDescription'])
            }
          />
        </Panel>
      </section>
    )

  return (
    <section className="flex min-w-0 flex-col gap-2 pt-6">
      <h2 className="flex h-6 items-center text-[15px] leading-6 font-medium text-text-secondary">
        {t(($) => $['newKnowledge.overview.inventory'])}
      </h2>
      <Panel className="h-44.25 overflow-hidden border border-divider-subtle p-4 shadow-none">
        {loading ? (
          <>
            <Skeleton className="h-6 w-full" />
            <div className="mt-2.5 h-3.75">
              <Skeleton className="h-3.5 w-80" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-20 rounded-lg bg-background-section p-3">
                  <Skeleton className="h-2.5 w-20" />
                  <Skeleton className="mt-2 h-5 w-24" />
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div
              className="flex h-6 gap-0.5 overflow-hidden"
              aria-label={t(($) => $['newKnowledge.overview.sources'])}
            >
              {visibleCategories.map((category) => (
                <span
                  key={category.label}
                  className={cn('border-l-4', category.segment)}
                  style={{
                    width: categoryTotal ? `${(category.value / categoryTotal) * 100}%` : '0%',
                  }}
                />
              ))}
            </div>
            <ul className="mt-2.5 flex min-h-3.75 flex-wrap gap-x-4 gap-y-1">
              {categories.map((category) => (
                <li
                  key={category.label}
                  className="flex items-center gap-1.5 text-[12px] leading-3.75 font-normal text-text-tertiary"
                >
                  <span aria-hidden className={cn('size-2 rounded-full', category.color)} />
                  {category.label}
                  <span className="font-semibold text-text-secondary">{category.value}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                {
                  detail: `+${inventory?.graph_entities.added_last_7d ?? 0}`,
                  label: t(($) => $['newKnowledge.overview.graphEntities']),
                  value: compactNumber(inventory?.graph_entities.total ?? 0),
                },
                {
                  detail: `+${inventory?.graph_relations.added_last_7d ?? 0}`,
                  label: t(($) => $['newKnowledge.overview.graphRelations']),
                  value: compactNumber(inventory?.graph_relations.total ?? 0),
                },
                {
                  detail: t(($) => $['newKnowledge.overview.indexedSlices'], {
                    indexed: inventory?.index_coverage.indexed ?? 0,
                    total: inventory?.index_coverage.total ?? 0,
                  }),
                  label: t(($) => $['newKnowledge.overview.indexCoverage']),
                  value: `${Math.round(inventory?.index_coverage.percentage ?? 0)}%`,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex h-20 flex-col gap-1 rounded-lg bg-background-section p-3"
                >
                  <p className="system-2xs-medium text-text-tertiary">{item.label}</p>
                  <p className="text-[18px] leading-5 font-semibold text-text-primary">
                    {item.value}
                  </p>
                  <p className="system-2xs-regular text-text-tertiary">{item.detail}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>
    </section>
  )
}
