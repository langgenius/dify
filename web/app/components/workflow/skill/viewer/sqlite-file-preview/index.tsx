import type { FC } from 'react'
import * as React from 'react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useSQLiteDatabase } from '../../hooks/use-sqlite-database'
import { PREVIEW_ROW_LIMIT } from './constants'
import TablePanel from './table-panel'
import TableSelector from './table-selector'
import { useSQLiteTable } from './use-sqlite-table'

type SQLiteFilePreviewProps = {
  downloadUrl: string
}

const SQLiteFilePreview: FC<SQLiteFilePreviewProps> = ({
  downloadUrl,
}) => {
  const { t } = useTranslation('workflow')
  const { tables, isLoading, error, queryTable } = useSQLiteDatabase(downloadUrl)
  const [selectedTableId, setSelectedTableId] = useState<string>('')
  const tableScrollRef = useRef<HTMLDivElement | null>(null)

  const selectedTable = useMemo(() => {
    if (tables.length === 0)
      return ''
    if (selectedTableId && tables.includes(selectedTableId))
      return selectedTableId
    return tables[0]
  }, [selectedTableId, tables])
  const tableState = useSQLiteTable({ selectedTable, queryTable })
  const isTruncated = tableState.data !== null && tableState.data.values.length >= PREVIEW_ROW_LIMIT

  if (!downloadUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center text-text-tertiary">
        <span className="system-sm-regular">
          {t('skillEditor.previewUnavailable')}
        </span>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loading type="area" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center text-text-tertiary">
        <span className="system-sm-regular">
          {t('skillSidebar.sqlitePreview.loadError')}
        </span>
      </div>
    )
  }

  if (tables.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-text-tertiary">
        <span className="system-sm-regular">
          {t('skillSidebar.sqlitePreview.emptyTables')}
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-1 overflow-hidden p-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TableSelector
          tables={tables}
          selectedTable={selectedTable}
          onTableChange={setSelectedTableId}
          isLoading={tableState.isLoading}
        />
      </div>
      <TablePanel
        data={tableState.data}
        isLoading={tableState.isLoading}
        error={tableState.error}
        scrollRef={tableScrollRef}
        isTruncated={isTruncated}
      />
    </div>
  )
}

export default React.memo(SQLiteFilePreview)
