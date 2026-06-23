'use client'

import { useTranslation } from '#i18n'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
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
import { API_KEY_DETAIL_TABLE_COLUMN_CLASS_NAMES } from '../table-styles'

const DEVELOPER_API_KEY_SKELETON_KEYS = ['primary-key', 'secondary-key']

export function DeveloperApiSkeleton() {
  return (
    <div className="flex flex-col gap-4" data-slot="deployment-developer-api-skeleton">
      <ApiUrlSkeleton />
      <ApiKeyTableSkeleton />
    </div>
  )
}

function ApiUrlSkeleton() {
  return (
    <div
      className="flex h-8 items-center gap-1 rounded-lg border border-components-input-border-active bg-components-input-bg-normal pr-1 pl-1.5"
      data-slot="deployment-developer-api-url-skeleton"
    >
      <SkeletonRectangle className="my-0 h-5 w-16 shrink-0 animate-pulse rounded-md" />
      <SkeletonRectangle className="my-0 h-4 min-w-0 flex-1 animate-pulse" />
      <div className="h-3.5 w-px shrink-0 bg-divider-regular" />
      <SkeletonRectangle className="my-0 size-6 shrink-0 animate-pulse rounded-md" />
    </div>
  )
}

function ApiKeyTableSkeleton() {
  return (
    <>
      <DetailTableCardList className="pc:hidden">
        {DEVELOPER_API_KEY_SKELETON_KEYS.map(key => (
          <DetailTableCard key={key} data-slot="deployment-developer-api-mobile-row-skeleton">
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SkeletonRectangle className="my-0 h-3.5 w-32 animate-pulse" />
                  <SkeletonRectangle className="mt-2 h-5 w-20 animate-pulse rounded-md" />
                </div>
                <SkeletonRectangle className="my-0 size-8 shrink-0 animate-pulse rounded-md" />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <SkeletonRectangle className="my-0 h-2.5 w-14 animate-pulse" />
                <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
              </div>
            </div>
          </DetailTableCard>
        ))}
      </DetailTableCardList>
      <div className="hidden pc:block">
        <DetailTable>
          <ApiKeyTableHeaderSkeleton />
          <DetailTableBody>
            {DEVELOPER_API_KEY_SKELETON_KEYS.map(key => (
              <ApiKeyDesktopRowSkeleton key={key} />
            ))}
          </DetailTableBody>
        </DetailTable>
      </div>
    </>
  )
}

function ApiKeyTableHeaderSkeleton() {
  const { t } = useTranslation('deployments')

  return (
    <DetailTableHeader>
      <DetailTableRow>
        <DetailTableHead className={API_KEY_DETAIL_TABLE_COLUMN_CLASS_NAMES.name}>{t('access.api.table.name')}</DetailTableHead>
        <DetailTableHead className={API_KEY_DETAIL_TABLE_COLUMN_CLASS_NAMES.environment}>{t('access.api.table.environment')}</DetailTableHead>
        <DetailTableHead className={API_KEY_DETAIL_TABLE_COLUMN_CLASS_NAMES.key}>{t('access.api.table.key')}</DetailTableHead>
        <DetailTableHead className={`${API_KEY_DETAIL_TABLE_COLUMN_CLASS_NAMES.action} text-right`}>{t('access.api.table.action')}</DetailTableHead>
      </DetailTableRow>
    </DetailTableHeader>
  )
}

function ApiKeyDesktopRowSkeleton() {
  return (
    <DetailTableRow data-slot="deployment-developer-api-desktop-row-skeleton">
      <DetailTableCell>
        <SkeletonRectangle className="my-0 h-3.5 w-32 animate-pulse" />
      </DetailTableCell>
      <DetailTableCell>
        <SkeletonRectangle className="my-0 h-5 w-20 animate-pulse rounded-md" />
      </DetailTableCell>
      <DetailTableCell>
        <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
      </DetailTableCell>
      <DetailTableCell>
        <div className="flex justify-end">
          <SkeletonRectangle className="my-0 size-8 animate-pulse rounded-md" />
        </div>
      </DetailTableCell>
    </DetailTableRow>
  )
}
