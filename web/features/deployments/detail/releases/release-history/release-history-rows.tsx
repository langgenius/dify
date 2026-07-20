'use client'

import type { Release } from '@dify/contracts/enterprise/types.gen'
import type { ReleaseWithSummaryDeployments } from './release-deployments'
import { ReleaseSource } from '@dify/contracts/enterprise/types.gen'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import {
  DetailTable,
  DetailTableBody,
  DetailTableCard,
  DetailTableCardList,
  DetailTableCell,
  DetailTableHead,
  DetailTableHeader,
  DetailTableRow,
} from '../../../shared/components/detail-table'
import { TitleTooltip } from '../../../shared/components/title-tooltip'
import { formatDate, releaseCommit } from '../../../shared/domain/release'
import { DeployReleaseMenu } from '../release-actions/deploy-release-menu'
import { ReleaseDeploymentsContent } from './release-history-deployments'
import { RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES } from './table-styles'

function ReleaseTitleTooltip({ release }: { release: Release }) {
  const { t } = useTranslation('deployments')

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex max-w-full cursor-default truncate text-text-primary">
            {release.displayName}
          </span>
        }
      />
      <TooltipContent>
        {t(($) => $['versions.commitTooltip'], { commit: releaseCommit(release) })}
      </TooltipContent>
    </Tooltip>
  )
}

function CreatedAtCell({ createdAt }: { createdAt: string }) {
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const ms = Date.parse(createdAt)
  if (Number.isNaN(ms)) return <>{formatDate(createdAt)}</>
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-default">{formatTimeFromNow(ms)}</span>} />
      <TooltipContent>{formatDate(createdAt)}</TooltipContent>
    </Tooltip>
  )
}

function ReleaseSourceCell({ release }: { release: Release }) {
  const { t } = useTranslation('deployments')
  const sourceAppId = release.sourceAppId

  if (!sourceAppId) {
    return (
      <span className="text-text-tertiary">
        {release.source === ReleaseSource.RELEASE_SOURCE_UPLOAD
          ? t(($) => $['versions.manualDslOption'])
          : '—'}
      </span>
    )
  }

  return <ReleaseSourceLink sourceAppId={sourceAppId} />
}

function ReleaseSourceLink({ sourceAppId }: { sourceAppId: string }) {
  const sourceAppQuery = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: {
        params: { app_id: sourceAppId },
      },
    }),
  )
  const sourceAppName = sourceAppQuery.data?.name
  const label = sourceAppName || sourceAppId
  const title = sourceAppName ? `${sourceAppName} (${sourceAppId})` : sourceAppId

  return (
    <TitleTooltip content={title}>
      <Link
        href={`/app/${encodeURIComponent(sourceAppId)}/workflow`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-full min-w-0 items-center gap-1 text-text-secondary transition-colors hover:text-text-accent"
      >
        <span className="min-w-0 truncate">{label}</span>
        <span className="i-ri-arrow-right-up-line size-3.5 shrink-0" aria-hidden="true" />
      </Link>
    </TitleTooltip>
  )
}

function ReleaseHistoryMobileRows({
  releaseRows,
  onReleaseDeleted,
}: {
  releaseRows: ReleaseWithSummaryDeployments[]
  onReleaseDeleted?: () => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <DetailTableCardList className="pc:hidden">
      {releaseRows.map((row) => {
        const release = row
        const releaseId = release.id
        const hasDeployments = row.summaryDeployments.length > 0

        return (
          <DetailTableCard key={releaseId}>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <ReleaseTitleTooltip release={release} />
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 system-xs-regular text-text-secondary">
                    <CreatedAtCell createdAt={release.createdAt} />
                    <span aria-hidden>·</span>
                    <span>{row.createdBy.displayName}</span>
                    {(release.sourceAppId ||
                      release.source === ReleaseSource.RELEASE_SOURCE_UPLOAD) && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="inline-flex max-w-full min-w-0 items-baseline gap-1">
                          <span className="shrink-0">{t(($) => $['versions.col.sourceApp'])}</span>
                          <ReleaseSourceCell release={release} />
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 justify-end gap-1">
                  <DeployReleaseMenu
                    releaseId={releaseId}
                    releaseRows={releaseRows}
                    onDeleted={onReleaseDeleted}
                  />
                </div>
              </div>
              {hasDeployments && (
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  <ReleaseDeploymentsContent items={row.summaryDeployments} />
                </div>
              )}
            </div>
          </DetailTableCard>
        )
      })}
    </DetailTableCardList>
  )
}

export function ReleaseHistoryRows({
  releaseRows,
  onReleaseDeleted,
}: {
  releaseRows: ReleaseWithSummaryDeployments[]
  onReleaseDeleted?: () => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <>
      <ReleaseHistoryMobileRows releaseRows={releaseRows} onReleaseDeleted={onReleaseDeleted} />
      <div className="hidden pc:block">
        <DetailTable className="min-w-[840px]">
          <DetailTableHeader>
            <DetailTableRow>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.release}>
                {t(($) => $['versions.col.release'])}
              </DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.sourceApp}>
                {t(($) => $['versions.col.sourceApp'])}
              </DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.createdAt}>
                {t(($) => $['versions.col.createdAt'])}
              </DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.author}>
                {t(($) => $['versions.col.author'])}
              </DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.deployedTo}>
                {t(($) => $['versions.col.deployedTo'])}
              </DetailTableHead>
              <DetailTableHead
                className={`${RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.action} text-right`}
              >
                {t(($) => $['versions.col.action'])}
              </DetailTableHead>
            </DetailTableRow>
          </DetailTableHeader>
          <DetailTableBody>
            {releaseRows.map((row) => {
              const release = row
              const releaseId = release.id

              return (
                <DetailTableRow key={releaseId}>
                  <DetailTableCell className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.release}>
                    <ReleaseTitleTooltip release={release} />
                  </DetailTableCell>
                  <DetailTableCell className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.sourceApp}>
                    <ReleaseSourceCell release={release} />
                  </DetailTableCell>
                  <DetailTableCell
                    className={`${RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.createdAt} text-text-secondary`}
                  >
                    <CreatedAtCell createdAt={release.createdAt} />
                  </DetailTableCell>
                  <DetailTableCell
                    className={`${RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.author} truncate text-text-secondary`}
                  >
                    {row.createdBy.displayName}
                  </DetailTableCell>
                  <DetailTableCell className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.deployedTo}>
                    <div className="flex flex-wrap gap-1">
                      <ReleaseDeploymentsContent items={row.summaryDeployments} />
                    </div>
                  </DetailTableCell>
                  <DetailTableCell className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.action}>
                    <div className="flex justify-end">
                      <DeployReleaseMenu
                        releaseId={releaseId}
                        releaseRows={releaseRows}
                        onDeleted={onReleaseDeleted}
                      />
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
