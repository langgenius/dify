'use client'

import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
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
import { RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES } from './table-styles'

const RELEASE_TABLE_ROW_SKELETON_KEYS = ['latest', 'previous', 'older', 'archived', 'initial']

function ReleaseDeploymentsSkeleton() {
  return (
    <SkeletonRow className="gap-1">
      <SkeletonRectangle className="my-0 h-5 w-20 animate-pulse rounded-md" />
      <SkeletonRectangle className="my-0 h-5 w-18 animate-pulse rounded-md" />
    </SkeletonRow>
  )
}

export function ReleaseHistoryTableSkeleton() {
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
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.release}>{t($ => $['versions.col.release'])}</DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.sourceApp}>{t($ => $['versions.col.sourceApp'])}</DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.createdAt}>{t($ => $['versions.col.createdAt'])}</DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.author}>{t($ => $['versions.col.author'])}</DetailTableHead>
              <DetailTableHead className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.deployedTo}>{t($ => $['versions.col.deployedTo'])}</DetailTableHead>
              <DetailTableHead className={`${RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.action} text-right`}>{t($ => $['versions.col.action'])}</DetailTableHead>
            </DetailTableRow>
          </DetailTableHeader>
          <DetailTableBody>
            {RELEASE_TABLE_ROW_SKELETON_KEYS.map(key => (
              <DetailTableRow key={key}>
                <DetailTableCell className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.release}>
                  <SkeletonRectangle className="h-3 w-24 animate-pulse" />
                </DetailTableCell>
                <DetailTableCell className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.sourceApp}>
                  <SkeletonRectangle className="h-3 w-32 animate-pulse" />
                </DetailTableCell>
                <DetailTableCell className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.createdAt}>
                  <SkeletonRectangle className="h-3 w-24 animate-pulse" />
                </DetailTableCell>
                <DetailTableCell className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.author}>
                  <SkeletonRectangle className="h-3 w-24 animate-pulse" />
                </DetailTableCell>
                <DetailTableCell className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.deployedTo}>
                  <ReleaseDeploymentsSkeleton />
                </DetailTableCell>
                <DetailTableCell className={RELEASE_DETAIL_TABLE_COLUMN_CLASS_NAMES.action}>
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
