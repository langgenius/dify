'use client'

import { Pagination } from '@langgenius/dify-ui/pagination'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { DeploymentEmptyState, DeploymentStateMessage } from '../../../shared/components/empty-state'
import {
  adjustReleaseHistoryPageAfterDeleteAtom,
  RELEASE_HISTORY_PAGE_SIZE,
  releaseHistoryAtom,
  releaseHistoryCurrentPageAtom,
  releaseHistoryIsErrorAtom,
  releaseHistoryIsLoadingAtom,
  setReleaseHistoryCurrentPageAtom,
} from '../state'
import { ReleaseHistoryRows } from './release-history-rows'
import { ReleaseHistoryTableSkeleton } from './release-history-table-skeleton'
import { releaseRowFromSummary } from './release-history-types'

export function ReleaseHistoryTable() {
  const { t } = useTranslation('deployments')
  const currentPage = useAtomValue(releaseHistoryCurrentPageAtom)
  const setCurrentPage = useSetAtom(setReleaseHistoryCurrentPageAtom)
  const adjustPageAfterDelete = useSetAtom(adjustReleaseHistoryPageAfterDeleteAtom)
  const releaseHistory = useAtomValue(releaseHistoryAtom)
  const isLoading = useAtomValue(releaseHistoryIsLoadingAtom)
  const hasError = useAtomValue(releaseHistoryIsErrorAtom)

  if (isLoading)
    return <ReleaseHistoryTableSkeleton />

  if (hasError) {
    return (
      <DeploymentStateMessage variant="list">
        {t('common.loadFailed')}
      </DeploymentStateMessage>
    )
  }

  if (!releaseHistory) {
    return (
      <DeploymentStateMessage variant="list">
        {t('common.loadFailed')}
      </DeploymentStateMessage>
    )
  }

  const releaseRows = releaseHistory.releaseSummaries.map(releaseRowFromSummary)
  const totalReleases = releaseHistory.pagination.totalCount ?? releaseRows.length
  const totalReleasePages = Math.ceil(totalReleases / RELEASE_HISTORY_PAGE_SIZE)

  function handleReleaseDeleted() {
    adjustPageAfterDelete(releaseRows.length)
  }

  if (releaseRows.length === 0) {
    return (
      <DeploymentEmptyState
        icon="i-ri-stack-line"
        title={t('versions.emptyTitle')}
        description={t('versions.emptyDescription')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ReleaseHistoryRows
        releaseRows={releaseRows}
        onReleaseDeleted={handleReleaseDeleted}
      />
      {totalReleases > RELEASE_HISTORY_PAGE_SIZE && (
        <Pagination
          className="border-y border-divider-subtle"
          page={currentPage + 1}
          totalPages={totalReleasePages}
          onPageChange={page => setCurrentPage(page - 1)}
        />
      )}
    </div>
  )
}
