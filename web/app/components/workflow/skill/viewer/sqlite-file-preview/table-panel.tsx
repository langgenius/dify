import type { RefObject } from 'react'
import type { SQLiteQueryResult } from '../../hooks/sqlite/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import DataTable from './data-table'

type TablePanelProps = {
  data: SQLiteQueryResult | null
  isLoading: boolean
  error: Error | null
  scrollRef: RefObject<HTMLDivElement | null>
  isTruncated?: boolean
}

const TablePanel = ({
  data,
  isLoading,
  error,
  scrollRef,
  isTruncated = false,
}: TablePanelProps) => {
  const { t } = useTranslation('workflow')

  return (
    <div
      ref={scrollRef}
      className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg bg-components-panel-bg"
    >
      {isLoading
        ? (
            <div className="flex h-full w-full items-center justify-center">
              <Loading type="area" />
            </div>
          )
        : error
          ? (
              <div className="flex h-full w-full items-center justify-center text-text-tertiary">
                <span className="system-sm-regular">
                  {t('skillSidebar.sqlitePreview.loadError')}
                </span>
              </div>
            )
          : data
            ? (
                <DataTable
                  columns={data.columns}
                  values={data.values}
                  scrollRef={scrollRef}
                  isTruncated={isTruncated}
                />
              )
            : (
                <div className="flex h-full w-full items-center justify-center text-text-tertiary">
                  <span className="system-sm-regular">
                    {t('skillSidebar.sqlitePreview.emptyRows')}
                  </span>
                </div>
              )}
    </div>
  )
}

export default React.memo(TablePanel)
