'use client'

import { Pagination } from '@langgenius/dify-ui/pagination'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { DeploymentEmptyState, DeploymentStateMessage } from '../../components/empty-state'
import { RELEASE_HISTORY_PAGE_SIZE } from '../../data'
import { ReleaseHistoryRows } from './release-history-rows'
import { ReleaseHistoryTableSkeleton } from './release-history-table-skeleton'
import { releaseRowFromSummary } from './release-history-types'

export function ReleaseHistoryTable({ appInstanceId }: {
  appInstanceId: string
}) {
  const { t } = useTranslation('deployments')
  const [currentPage, setCurrentPage] = useState(0)
  const releaseHistoryQuery = useQuery(consoleQuery.enterprise.releaseService.listReleaseSummaries.queryOptions({
    input: {
      params: { appInstanceId },
      query: {
        pageNumber: currentPage + 1,
        resultsPerPage: RELEASE_HISTORY_PAGE_SIZE,
      },
    },
    placeholderData: keepPreviousData,
  }))
  const releaseRows = releaseHistoryQuery.data?.data?.flatMap((releaseSummary) => {
    const releaseRow = releaseRowFromSummary(releaseSummary)
    return releaseRow ? [releaseRow] : []
  }) ?? []
  const totalReleases = releaseHistoryQuery.data?.pagination?.totalCount ?? releaseRows.length
  const totalReleasePages = Math.ceil(totalReleases / RELEASE_HISTORY_PAGE_SIZE)
  const isLoading = releaseHistoryQuery.isLoading
  const hasError = releaseHistoryQuery.isError

  function handleReleaseDeleted() {
    if (releaseRows.length === 1 && currentPage > 0)
      setCurrentPage(page => Math.max(page - 1, 0))
  }

  if (isLoading)
    return <ReleaseHistoryTableSkeleton />

  if (hasError) {
    return (
      <DeploymentStateMessage variant="list">
        {t('common.loadFailed')}
      </DeploymentStateMessage>
    )
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
        appInstanceId={appInstanceId}
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
