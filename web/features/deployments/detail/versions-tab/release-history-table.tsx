'use client'

import type { EnvironmentDeployment, ReleaseRow } from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import type { ReleaseDeployment } from './release-deployments'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Pagination from '@/app/components/base/pagination'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleQuery } from '@/service/client'
import { RELEASE_HISTORY_PAGE_SIZE } from '../../data'
import {
  formatDate,
  releaseCommit,
  releaseLabel,
} from '../../release'
import { isUndeployedDeploymentRow } from '../../runtime-status'
import { DeployReleaseMenu } from './deploy-release-menu'
import { DeployedToBadge } from './deployed-to-badge'
import { getReleaseDeployments } from './release-deployments'

const RELEASE_TABLE_CLASS_NAME = 'w-full max-w-full min-w-[700px] border-collapse border-0 text-sm'
const RELEASE_TABLE_HEADER_CLASS_NAME = 'h-8 border-b border-divider-subtle text-xs leading-8 font-medium text-text-tertiary uppercase'
const RELEASE_TABLE_HEADER_CELL_CLASS_NAME = 'box-border max-w-[200px] py-0 pr-2.5 pl-3'
const RELEASE_TABLE_CELL_CLASS_NAME = 'box-border max-w-[200px] py-[5px] pr-2.5 pl-3 align-middle'
const RELEASE_TABLE_ROW_CLASS_NAME = 'h-8 border-b border-divider-subtle hover:bg-background-default-hover last:border-b-0'
const RELEASE_TABLE_HEADER_SKELETON_KEYS = ['version', 'description', 'author', 'deployments', 'actions']
const RELEASE_TABLE_ROW_SKELETON_KEYS = ['latest', 'previous', 'older', 'archived', 'initial']

type ReleaseRowWithId = ReleaseRow & {
  id: string
}

function hasReleaseId(row: ReleaseRow): row is ReleaseRowWithId {
  return Boolean(row.id)
}

function ReleaseHistoryTableState({ children }: {
  children: ReactNode
}) {
  return (
    <div className="flex min-h-36 items-center justify-center border-y border-dashed border-divider-subtle px-4 py-12 text-center system-sm-regular text-text-tertiary">
      {children}
    </div>
  )
}

function ReleaseHistoryTableSkeleton() {
  return (
    <>
      <div className="overflow-hidden border-y border-divider-subtle pc:hidden">
        {RELEASE_TABLE_ROW_SKELETON_KEYS.map(key => (
          <div key={key} className="border-b border-divider-subtle last:border-b-0">
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
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto pc:block">
        <table className={RELEASE_TABLE_CLASS_NAME}>
          <thead className={RELEASE_TABLE_HEADER_CLASS_NAME}>
            <tr>
              {RELEASE_TABLE_HEADER_SKELETON_KEYS.map(key => (
                <td key={key} className={RELEASE_TABLE_HEADER_CELL_CLASS_NAME}>
                  <SkeletonRectangle className="h-3 w-20 animate-pulse" />
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {RELEASE_TABLE_ROW_SKELETON_KEYS.map(key => (
              <tr key={key} className={RELEASE_TABLE_ROW_CLASS_NAME}>
                <td className={RELEASE_TABLE_CELL_CLASS_NAME}>
                  <SkeletonRectangle className="h-3 w-24 animate-pulse" />
                </td>
                <td className={RELEASE_TABLE_CELL_CLASS_NAME}>
                  <SkeletonRectangle className="h-3 w-32 animate-pulse" />
                </td>
                <td className={RELEASE_TABLE_CELL_CLASS_NAME}>
                  <SkeletonRectangle className="h-3 w-24 animate-pulse" />
                </td>
                <td className={RELEASE_TABLE_CELL_CLASS_NAME}>
                  <ReleaseDeploymentsSkeleton />
                </td>
                <td className={RELEASE_TABLE_CELL_CLASS_NAME}>
                  <SkeletonRectangle className="my-0 h-7 w-8 animate-pulse rounded-lg" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    <div className="overflow-hidden border-y border-divider-subtle pc:hidden">
      {releaseRows.map((row) => {
        const release = row
        const releaseDeployments = getReleaseDeployments(row, deploymentRows)
        const hasDeployments = releaseDeployments.length > 0 || deployedToLoading || deployedToHasError

        return (
          <div key={release.id} className="border-b border-divider-subtle last:border-b-0">
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <span className="inline-flex max-w-full cursor-default truncate font-mono system-sm-medium text-text-primary">
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
          </div>
        )
      })}
    </div>
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
    return <span className="system-sm-regular text-text-tertiary">{loadFailedLabel}</span>

  if (items.length === 0)
    return <span className="system-sm-regular text-text-quaternary">—</span>

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
      <div className="hidden overflow-x-auto pc:block">
        <table className={RELEASE_TABLE_CLASS_NAME}>
          <thead className={RELEASE_TABLE_HEADER_CLASS_NAME}>
            <tr>
              <td className={RELEASE_TABLE_HEADER_CELL_CLASS_NAME}>{t('versions.col.release')}</td>
              <td className={`${RELEASE_TABLE_HEADER_CELL_CLASS_NAME} w-44`}>{t('versions.col.createdAt')}</td>
              <td className={`${RELEASE_TABLE_HEADER_CELL_CLASS_NAME} w-44`}>{t('versions.col.author')}</td>
              <td className={`${RELEASE_TABLE_HEADER_CELL_CLASS_NAME} w-40`}>{t('versions.col.deployedTo')}</td>
              <td className={`${RELEASE_TABLE_HEADER_CELL_CLASS_NAME} w-20`}>{t('versions.col.action')}</td>
            </tr>
          </thead>
          <tbody className="text-text-secondary">
            {releaseRows.map((row) => {
              const release = row
              const releaseDeployments = getReleaseDeployments(row, deploymentRows)

              return (
                <tr key={release.id} className={RELEASE_TABLE_ROW_CLASS_NAME}>
                  <td className={RELEASE_TABLE_CELL_CLASS_NAME}>
                    <Tooltip>
                      <TooltipTrigger
                        render={(
                          <span className="inline-flex max-w-full cursor-default truncate font-mono system-sm-medium text-text-primary">
                            {releaseLabel(release)}
                          </span>
                        )}
                      />
                      <TooltipContent>
                        {t('versions.commitTooltip', { commit: releaseCommit(release) })}
                      </TooltipContent>
                    </Tooltip>
                  </td>
                  <td className={`${RELEASE_TABLE_CELL_CLASS_NAME} w-44 system-sm-regular text-text-secondary`}>
                    <CreatedAtCell createdAt={release.createdAt} />
                  </td>
                  <td className={`${RELEASE_TABLE_CELL_CLASS_NAME} w-44 system-sm-regular text-text-secondary`}>
                    {row.createdBy?.name ?? '—'}
                  </td>
                  <td className={`${RELEASE_TABLE_CELL_CLASS_NAME} w-40`}>
                    <div className="flex flex-wrap gap-1">
                      <ReleaseDeploymentsContent
                        items={releaseDeployments}
                        isLoading={deployedToLoading}
                        hasError={deployedToHasError}
                        loadFailedLabel={t('common.loadFailed')}
                      />
                    </div>
                  </td>
                  <td className={`${RELEASE_TABLE_CELL_CLASS_NAME} w-20`}>
                    <DeployReleaseMenu releaseId={release.id} appInstanceId={appInstanceId} releaseRows={releaseRows} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
  const overviewQuery = useQuery(consoleQuery.enterprise.appInstanceService.getAppInstanceOverview.queryOptions({
    input,
  }))
  const releaseHistoryQuery = useQuery(consoleQuery.enterprise.appReleaseService.listReleases.queryOptions({
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
  const shouldLoadRuntimeInstances = releaseRows.length > 0
  const environmentDeploymentsQuery = useQuery(consoleQuery.enterprise.appDeploymentService.listEnvironmentDeployments.queryOptions({
    input,
    enabled: shouldLoadRuntimeInstances,
  }))
  const isLoading = releaseHistoryQuery.isLoading
    || (releaseRows.length === 0 && overviewQuery.isLoading)
  const hasError = releaseHistoryQuery.isError
    || (releaseRows.length === 0 && overviewQuery.isError)
  const deployedToLoading = shouldLoadRuntimeInstances && environmentDeploymentsQuery.isLoading
  const deployedToHasError = shouldLoadRuntimeInstances && environmentDeploymentsQuery.isError
  const sourceAppUnavailable = overviewQuery.data?.overview?.appInstance?.sourceAppAvailable === false
  const deploymentRows = environmentDeploymentsQuery.data?.data?.filter(row => Boolean(row.environment?.id) && !isUndeployedDeploymentRow(row)) ?? []

  if (isLoading) {
    return <ReleaseHistoryTableSkeleton />
  }

  if (hasError) {
    return (
      <ReleaseHistoryTableState>
        {t('common.loadFailed')}
      </ReleaseHistoryTableState>
    )
  }

  if (releaseRows.length === 0) {
    return (
      <ReleaseHistoryTableState>
        {sourceAppUnavailable ? t('versions.emptySourceUnavailable') : t('versions.emptyWithCreate')}
      </ReleaseHistoryTableState>
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
          current={currentPage}
          total={totalReleases}
          limit={RELEASE_HISTORY_PAGE_SIZE}
          onChange={setCurrentPage}
        />
      )}
    </div>
  )
}
