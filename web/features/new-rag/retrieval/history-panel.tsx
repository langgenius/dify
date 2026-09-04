'use client'

import type { RetrievalHistorySourceFilter } from './state/scoped'
import { Button } from '@langgenius/dify-ui/button'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { RecordButton } from './history'
import {
  loadMoreRetrievalHistoryAtom,
  retrievalHistoryFactsAtom,
  selectRetrievalRecordAtom,
} from './state/graph'
import { retrievalHistorySourceFilterAtom } from './state/scoped'

const sourceFilters = ['all', 'retrieval_test', 'workflow'] as const

export function RetrievalHistoryPanel() {
  const { t } = useTranslation('knowledgeSpace')
  const { activeRecordKey, displayRecords, hasNextPage, isFetchingNextPage, sourceFilter } =
    useAtomValue(retrievalHistoryFactsAtom)
  const selectRecord = useSetAtom(selectRetrievalRecordAtom)
  const loadMore = useSetAtom(loadMoreRetrievalHistoryAtom)
  const setSourceFilter = useSetAtom(retrievalHistorySourceFilterAtom)

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col pt-6">
      <div className="flex shrink-0 items-center justify-between gap-2 pr-3 pb-2 pl-3">
        <h2 className="system-xs-medium text-text-tertiary">
          {t(($) => $['retrievalTest.records'])}
        </h2>
        <SegmentedControl<RetrievalHistorySourceFilter>
          aria-label={t(($) => $['retrievalTest.sourceFilter.label'])}
          className="shrink-0"
          value={sourceFilter}
          onValueChange={setSourceFilter}
        >
          {sourceFilters.map((filter) => (
            <SegmentedControlItem<RetrievalHistorySourceFilter>
              key={filter}
              value={filter}
              className="px-1.5 py-0.5 system-2xs-medium"
            >
              {t(($) => $[`retrievalTest.sourceFilter.${filter}`])}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
      <div className="min-h-0 flex-1 scrollbar-none overflow-y-auto">
        {displayRecords.length > 0 ? (
          <div>
            {displayRecords.map((record, index) => (
              <RecordButton
                key={`${record.kind}:${record.id}`}
                index={index}
                record={record}
                active={activeRecordKey === `${record.kind}:${record.id}`}
                onClick={() => selectRecord(record)}
              />
            ))}
            {hasNextPage && (
              <div className="px-3 py-2">
                <Button className="w-full" disabled={isFetchingNextPage} onClick={loadMore}>
                  {t(($) => $.loadMore)}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="px-3 py-5 body-sm-regular text-text-quaternary">
            {t(($) => $['retrievalTest.emptyRecords'])}
          </p>
        )}
      </div>
    </div>
  )
}
