'use client'

import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import type { ReleaseDeployment } from './release-deployments'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { keepPreviousData, skipToken, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { RELEASE_HISTORY_PAGE_SIZE } from '../../data'
import {
  formatDate,
  releaseCommit,
  releaseLabel,
} from '../../release'
import { isUndeployedDeploymentRow } from '../../runtime-status'
import {
  DetailListState,
} from '../common'
import {
  DetailTable,
  DetailTableBody,
  DetailTableCard,
  DetailTableCardList,
  DetailTableCell,
  DetailTableHead,
  DetailTableHeader,
  DetailTableRow,
} from '../table'
import {
  RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES,
} from '../table-styles'
import { DeployReleaseMenu } from './deploy-release-menu'
import { DeployedToBadge } from './deployed-to-badge'
import { getReleaseDeployments } from './release-deployments'

const RELEASE_TABLE_ROW_SKELETON_KEYS = ['latest', 'previous', 'older', 'archived', 'initial']

type ReleaseRowWithId = Release & {
  id: string
}

function hasReleaseId(row: Release): row is ReleaseRowWithId {
  return Boolean(row.id)
}

function ReleaseHistoryTableSkeleton() {
  const { t } = useTranslation('deployments')

  return (
    <>
      <DetailTableCardList className="pc:hidden">
        {RELEASE_TABLE_ROW_SKELETON_KEYS.map(key => (
          <DetailTableCard key={key}>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SkeletonRectangle className="h-3 w-24 animate-pulse" />
                  <SkeletonRow className="mt-1 gap-2">
                    <SkeletonRectangle className="h-3 w-28 animate-pulse" />
                    <SkeletonRectangle className="h-3 w-20 animate-pulse" />
                  </SkeletonRow>
                </div>
                <SkeletonRectangle className="my-0 h-7 w-8 animate-pulse rounded-lg" />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <ReleaseDeploymentsSkeleton />
              </div>
            </div>
          </DetailTableCard>
        ))}
      </DetailTableCardList>
      <div className="hidden pc:block">
        <DetailTable className="min-w-[840px]">
          <DetailTableHeader>
            <DetailTableRow>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.release}>{t('versions.col.release')}</DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.sourceApp}>{t('versions.col.sourceApp')}</DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.createdAt}>{t('versions.col.createdAt')}</DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.author}>{t('versions.col.author')}</DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.deployedTo}>{t('versions.col.deployedTo')}</DetailTableHead>
              <DetailTableHead className={`${RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.action} text-right`}>{t('versions.col.action')}</DetailTableHead>
            </DetailTableRow>
          </DetailTableHeader>
          <DetailTableBody>
            {RELEASE_TABLE_ROW_SKELETON_KEYS.map(key => (
              <DetailTableRow key={key}>
                <DetailTableCell>
                  <SkeletonRectangle className="h-3 w-24 animate-pulse" />
                </DetailTableCell>
                <DetailTableCell>
                  <SkeletonRectangle className="h-3 w-32 animate-pulse" />
                </DetailTableCell>
                <DetailTableCell>
                  <SkeletonRectangle className="h-3 w-24 animate-pulse" />
                </DetailTableCell>
                <DetailTableCell>
                  <SkeletonRectangle className="h-3 w-24 animate-pulse" />
                </DetailTableCell>
                <DetailTableCell>
                  <ReleaseDeploymentsSkeleton />
                </DetailTableCell>
                <DetailTableCell>
                  <div className="flex justify-end">
                    <SkeletonRectangle className="my-0 size-8 animate-pulse rounded-md" />
                  </div>
                </DetailTableCell>
              </DetailTableRow>
            ))}
          </DetailTableBody>
        </DetailTable>
      </div>
    </>
  )
}

function ReleaseHistoryMobileRows({ appInstanceId, releaseRows, deploymentRows, deployedToLoading, deployedToHasError }: {
  appInstanceId: string
  releaseRows: ReleaseRowWithId[]
  deploymentRows: EnvironmentDeployment[]
  deployedToLoading?: boolean
  deployedToHasError?: boolean
}) {
  const { t } = useTranslation('deployments')

  return (
    <DetailTableCardList className="pc:hidden">
      {releaseRows.map((row) => {
        const release = row
        const releaseDeployments = getReleaseDeployments(row, deploymentRows)
        const hasDeployments = releaseDeployments.length > 0 || deployedToLoading || deployedToHasError

        return (
          <DetailTableCard key={release.id}>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <span className="inline-flex max-w-full cursor-default truncate text-text-primary">
                          {releaseLabel(release)}
                        </span>
                      )}
                    />
                    <TooltipContent>
                      {t('versions.commitTooltip', { commit: releaseCommit(release) })}
                    </TooltipContent>
                  </Tooltip>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 system-xs-regular text-text-secondary">
                    <CreatedAtCell createdAt={release.createdAt} />
                    <span aria-hidden>·</span>
                    <span>{row.createdBy?.name ?? '—'}</span>
                    {release.sourceAppId && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="inline-flex max-w-full min-w-0 items-baseline gap-1">
                          <span className="shrink-0">{t('versions.col.sourceApp')}</span>
                          <SourceAppCell sourceAppId={release.sourceAppId} />
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 justify-end gap-1">
                  <DeployReleaseMenu releaseId={release.id} appInstanceId={appInstanceId} releaseRows={releaseRows} />
                </div>
              </div>
              {hasDeployments && (
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  <ReleaseDeploymentsContent
                    items={releaseDeployments}
                    isLoading={deployedToLoading}
                    hasError={deployedToHasError}
                    loadFailedLabel={t('common.loadFailed')}
                  />
                </div>
              )}
            </div>
          </DetailTableCard>
        )
      })}
    </DetailTableCardList>
  )
}

function ReleaseDeploymentsSkeleton() {
  return (
    <SkeletonRow className="gap-1">
      <SkeletonRectangle className="my-0 h-5 w-20 animate-pulse rounded-md" />
      <SkeletonRectangle className="my-0 h-5 w-18 animate-pulse rounded-md" />
    </SkeletonRow>
  )
}

function ReleaseDeploymentsContent({
  items,
  isLoading,
  hasError,
  loadFailedLabel,
}: {
  items: ReleaseDeployment[]
  isLoading?: boolean
  hasError?: boolean
  loadFailedLabel: string
}) {
  if (isLoading)
    return <ReleaseDeploymentsSkeleton />

  if (hasError)
    return <span className="text-text-tertiary">{loadFailedLabel}</span>

  if (items.length === 0)
    return <span className="text-text-quaternary">—</span>

  return items.map(item => (
    <DeployedToBadge
      key={`${item.environmentId}-${item.state}`}
      item={item}
    />
  ))
}

function CreatedAtCell({ createdAt }: {
  createdAt?: string
}) {
  const { formatTimeFromNow } = useFormatTimeFromNow()
  if (!createdAt)
    return <>—</>
  const ms = Date.parse(createdAt)
  if (Number.isNaN(ms))
    return <>{formatDate(createdAt)}</>
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <span className="cursor-default">
            {formatTimeFromNow(ms)}
          </span>
        )}
      />
      <TooltipContent>{formatDate(createdAt)}</TooltipContent>
    </Tooltip>
  )
}

function SourceAppCell({ sourceAppId }: {
  sourceAppId?: string
}) {
  const sourceAppQuery = useQuery(consoleQuery.apps.byAppId.get.queryOptions({
    input: sourceAppId
      ? {
          params: { app_id: sourceAppId },
        }
      : skipToken,
  }))

  if (!sourceAppId)
    return <span className="text-text-quaternary">—</span>

  const sourceAppName = sourceAppQuery.data?.name
  const label = sourceAppName || sourceAppId
  const title = sourceAppName ? `${sourceAppName} (${sourceAppId})` : sourceAppId

  return (
    <Link
      href={`/app/${encodeURIComponent(sourceAppId)}/workflow`}
      title={title}
      className="inline-flex max-w-full min-w-0 items-center gap-1 text-text-secondary hover:text-text-primary"
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="i-ri-external-link-line size-3.5 shrink-0 text-text-quaternary" aria-hidden="true" />
    </Link>
  )
}

function ReleaseHistoryRows({ appInstanceId, releaseRows, deploymentRows, deployedToLoading, deployedToHasError }: {
  appInstanceId: string
  releaseRows: ReleaseRowWithId[]
  deploymentRows: EnvironmentDeployment[]
  deployedToLoading?: boolean
  deployedToHasError?: boolean
}) {
  const { t } = useTranslation('deployments')

  return (
    <>
      <ReleaseHistoryMobileRows
        appInstanceId={appInstanceId}
        releaseRows={releaseRows}
        deploymentRows={deploymentRows}
        deployedToLoading={deployedToLoading}
        deployedToHasError={deployedToHasError}
      />
      <div className="hidden pc:block">
        <DetailTable className="min-w-[840px]">
          <DetailTableHeader>
            <DetailTableRow>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.release}>{t('versions.col.release')}</DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.sourceApp}>{t('versions.col.sourceApp')}</DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.createdAt}>{t('versions.col.createdAt')}</DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.author}>{t('versions.col.author')}</DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.deployedTo}>{t('versions.col.deployedTo')}</DetailTableHead>
              <DetailTableHead className={`${RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.action} text-right`}>{t('versions.col.action')}</DetailTableHead>
            </DetailTableRow>
          </DetailTableHeader>
          <DetailTableBody>
            {releaseRows.map((row) => {
              const release = row
              const releaseDeployments = getReleaseDeployments(row, deploymentRows)

              return (
                <DetailTableRow key={release.id}>
                  <DetailTableCell>
                    <Tooltip>
                      <TooltipTrigger
                        render={(
                          <span className="inline-flex max-w-full cursor-default truncate text-text-primary">
                            {releaseLabel(release)}
                          </span>
                        )}
                      />
                      <TooltipContent>
                        {t('versions.commitTooltip', { commit: releaseCommit(release) })}
                      </TooltipContent>
                    </Tooltip>
                  </DetailTableCell>
                  <DetailTableCell>
                    <SourceAppCell sourceAppId={release.sourceAppId} />
                  </DetailTableCell>
                  <DetailTableCell className="text-text-secondary">
                    <CreatedAtCell createdAt={release.createdAt} />
                  </DetailTableCell>
                  <DetailTableCell className="truncate text-text-secondary">
                    {row.createdBy?.name ?? '—'}
                  </DetailTableCell>
                  <DetailTableCell>
                    <div className="flex flex-wrap gap-1">
                      <ReleaseDeploymentsContent
                        items={releaseDeployments}
                        isLoading={deployedToLoading}
                        hasError={deployedToHasError}
                        loadFailedLabel={t('common.loadFailed')}
                      />
                    </div>
                  </DetailTableCell>
                  <DetailTableCell>
                    <div className="flex justify-end">
                      <DeployReleaseMenu releaseId={release.id} appInstanceId={appInstanceId} releaseRows={releaseRows} />
                    </div>
                  </DetailTableCell>
                </DetailTableRow>
              )
            })}
          </DetailTableBody>
        </DetailTable>
      </div>
    </>
  )
}

export function ReleaseHistoryTable({ appInstanceId }: {
  appInstanceId: string
}) {
  const { t } = useTranslation('deployments')
  const [currentPage, setCurrentPage] = useState(0)
  const input = { params: { appInstanceId } }
  const releaseHistoryQuery = useQuery(consoleQuery.enterprise.releaseService.listReleases.queryOptions({
    input: {
      ...input,
      query: {
        pageNumber: currentPage + 1,
        resultsPerPage: RELEASE_HISTORY_PAGE_SIZE,
      },
    },
    placeholderData: keepPreviousData,
  }))
  const releaseRows = releaseHistoryQuery.data?.data?.filter(hasReleaseId) ?? []
  const totalReleases = releaseHistoryQuery.data?.pagination?.totalCount ?? releaseRows.length
  const totalReleasePages = Math.ceil(totalReleases / RELEASE_HISTORY_PAGE_SIZE)
  const shouldLoadRuntimeInstances = releaseRows.length > 0
  const environmentDeploymentsQuery = useQuery(consoleQuery.enterprise.deploymentService.listEnvironmentDeployments.queryOptions({
    input,
    enabled: shouldLoadRuntimeInstances,
  }))
  const isLoading = releaseHistoryQuery.isLoading
  const hasError = releaseHistoryQuery.isError
  const deployedToLoading = shouldLoadRuntimeInstances && environmentDeploymentsQuery.isLoading
  const deployedToHasError = shouldLoadRuntimeInstances && environmentDeploymentsQuery.isError
  const deploymentRows = environmentDeploymentsQuery.data?.data?.filter(row => Boolean(row.environment?.id) && !isUndeployedDeploymentRow(row)) ?? []

  if (isLoading) {
    return <ReleaseHistoryTableSkeleton />
  }

  if (hasError) {
    return (
      <DetailListState>
        {t('common.loadFailed')}
      </DetailListState>
    )
  }

  if (releaseRows.length === 0) {
    return (
      <DetailListState>
        {t('versions.emptyWithCreate')}
      </DetailListState>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ReleaseHistoryRows
        appInstanceId={appInstanceId}
        releaseRows={releaseRows}
        deploymentRows={deploymentRows}
        deployedToLoading={deployedToLoading}
        deployedToHasError={deployedToHasError}
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
