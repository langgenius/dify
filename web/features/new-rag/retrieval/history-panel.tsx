'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { RecordButton } from './history'
import {
  loadMoreRetrievalHistoryAtom,
  retrievalHistoryFactsAtom,
  selectRetrievalRecordAtom,
} from './state/graph'

export function RetrievalHistoryPanel() {
  const { t } = useTranslation('knowledgeSpace')
  const { activeRecordKey, displayRecords, hasNextPage, isFetchingNextPage } =
    useAtomValue(retrievalHistoryFactsAtom)
  const selectRecord = useSetAtom(selectRetrievalRecordAtom)
  const loadMore = useSetAtom(loadMoreRetrievalHistoryAtom)

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col pt-6">
      <div className="flex shrink-0 items-center pb-2 pl-3">
        <h2 className="system-xs-medium text-text-tertiary">
          {t(($) => $['retrievalTest.records'])}
        </h2>
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
