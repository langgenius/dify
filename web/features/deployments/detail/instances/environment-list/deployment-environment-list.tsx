'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import { useTranslation } from 'react-i18next'
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
import { releaseCommit } from '../../../shared/domain/release'
import { isUndeployedDeploymentRow } from '../../../shared/domain/runtime-status'
import { DeploymentRowActions } from '../row-actions/deployment-row-actions'
import { DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES } from '../table-styles'
import { DeploymentStatusSummary } from './deployment-status-summary'

function EnvironmentSummary({
  environment,
}: {
  environment: EnvironmentDeployment['environment']
}) {
  return <span className="block truncate text-text-primary">{environment.displayName}</span>
}

function CurrentReleaseSummary({ release }: { release: EnvironmentDeployment['currentRelease'] }) {
  if (!release) return <span className="text-text-quaternary">—</span>

  const commit = releaseCommit(release)

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate text-text-primary">{release.displayName}</span>
        {commit !== '—' && (
          <span className="shrink-0 font-mono system-xs-regular text-text-tertiary">{commit}</span>
        )}
      </div>
    </div>
  )
}

function CurrentReleaseMobileSummary({
  release,
}: {
  release: EnvironmentDeployment['currentRelease']
}) {
  const { t } = useTranslation('deployments')

  if (!release) return null

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="system-2xs-medium-uppercase text-text-tertiary">
        {t(($) => $['deployTab.col.currentRelease'])}
      </span>
      <CurrentReleaseSummary release={release} />
    </div>
  )
}

function DeploymentEnvironmentMobileRow({ row }: { row: EnvironmentDeployment }) {
  const envId = row.environment.id
  const release = row.currentRelease

  return (
    <DetailTableCard>
      <div className="flex flex-col gap-3 p-4 text-left">
        <div className="flex min-w-0 flex-col gap-1">
          <EnvironmentSummary environment={row.environment} />
          <DeploymentStatusSummary row={row} />
        </div>
        {!isUndeployedDeploymentRow(row) && <CurrentReleaseMobileSummary release={release} />}
        <div className="flex min-w-0 items-center justify-start gap-2">
          <DeploymentRowActions envId={envId} row={row} />
        </div>
      </div>
    </DetailTableCard>
  )
}

function DeploymentEnvironmentDesktopRows({ rows }: { rows: EnvironmentDeployment[] }) {
  return (
    <>
      {rows.map((row) => {
        const envId = row.environment.id
        return (
          <DetailTableRow key={envId}>
            <DetailTableCell>
              <EnvironmentSummary environment={row.environment} />
            </DetailTableCell>
            <DetailTableCell>
              <DeploymentStatusSummary row={row} />
            </DetailTableCell>
            <DetailTableCell>
              <CurrentReleaseSummary release={row.currentRelease} />
            </DetailTableCell>
            <DetailTableCell className={DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES.actions}>
              <div className="flex min-h-8 justify-end">
                <DeploymentRowActions envId={envId} row={row} />
              </div>
            </DetailTableCell>
          </DetailTableRow>
        )
      })}
    </>
  )
}

export function DeploymentEnvironmentList({ rows }: { rows: EnvironmentDeployment[] }) {
  const { t } = useTranslation('deployments')

  return (
    <>
      <DetailTableCardList className="pc:hidden">
        {rows.map((row) => (
          <DeploymentEnvironmentMobileRow key={row.environment.id} row={row} />
        ))}
      </DetailTableCardList>
      <div className="hidden pc:block">
        <DetailTable>
          <DetailTableHeader>
            <DetailTableRow>
              <DetailTableHead className={DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES.environment}>
                {t(($) => $['deployTab.col.environment'])}
              </DetailTableHead>
              <DetailTableHead className={DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES.status}>
                {t(($) => $['deployTab.col.status'])}
              </DetailTableHead>
              <DetailTableHead
                className={DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES.currentRelease}
              >
                {t(($) => $['deployTab.col.currentRelease'])}
              </DetailTableHead>
              <DetailTableHead
                className={`${DEPLOYMENT_DETAIL_TABLE_COLUMN_CLASS_NAMES.actions} text-right`}
              >
                {t(($) => $['deployTab.col.actions'])}
              </DetailTableHead>
            </DetailTableRow>
          </DetailTableHeader>
          <DetailTableBody>
            <DeploymentEnvironmentDesktopRows rows={rows} />
          </DetailTableBody>
        </DetailTable>
      </div>
    </>
  )
}
