import type { FC } from 'react'
import * as React from 'react'
import { useEffect, useMemo, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useSQLiteDatabase } from '../../hooks/use-sqlite-database'
import DataTable from './data-table'
import TableSelector from './table-selector'

const ROW_LIMIT = 200

type SQLiteFilePreviewProps = {
  downloadUrl: string
}

const SQLiteFilePreview: FC<SQLiteFilePreviewProps> = ({
  downloadUrl,
}) => {
  const { t } = useTranslation('workflow')
  const { tables, isLoading, error, queryTable } = useSQLiteDatabase(downloadUrl)
  const [selectedTableId, setSelectedTableId] = useState<string>('')
  const [tableState, dispatch] = useReducer((
    current: {
      data: Awaited<ReturnType<typeof queryTable>> | null
      isLoading: boolean
      error: Error | null
    },
    action:
      | { type: 'reset' }
      | { type: 'loading' }
      | { type: 'success', data: Awaited<ReturnType<typeof queryTable>> | null }
      | { type: 'error', error: Error },
  ) => {
    switch (action.type) {
      case 'reset':
        return {
          data: null,
          isLoading: false,
          error: null,
        }
      case 'loading':
        return {
          data: null,
          isLoading: true,
          error: null,
        }
      case 'success':
        return {
          data: action.data,
          isLoading: false,
          error: null,
        }
      case 'error':
        return {
          data: null,
          isLoading: false,
          error: action.error,
        }
      default:
        return current
    }
  }, {
    data: null,
    isLoading: false,
    error: null,
  })

  const selectedTable = useMemo(() => {
    if (tables.length === 0)
      return ''
    if (selectedTableId && tables.includes(selectedTableId))
      return selectedTableId
    return tables[0]
  }, [selectedTableId, tables])

  useEffect(() => {
    if (!selectedTable) {
      dispatch({ type: 'reset' })
      return
    }

    let cancelled = false

    const loadTable = async () => {
      dispatch({ type: 'loading' })

      try {
        const data = await queryTable(selectedTable, ROW_LIMIT)
        if (!cancelled)
          dispatch({ type: 'success', data })
      }
      catch (err) {
        if (!cancelled)
          dispatch({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) })
      }
    }

    loadTable()

    return () => {
      cancelled = true
    }
  }, [queryTable, selectedTable])

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
    <div className="flex h-full w-full flex-col gap-1 p-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TableSelector
          tables={tables}
          selectedTable={selectedTable}
          onTableChange={setSelectedTableId}
          isLoading={tableState.isLoading}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-components-panel-bg">
        {tableState.isLoading
          ? (
              <div className="flex h-full w-full items-center justify-center">
                <Loading type="area" />
              </div>
            )
          : tableState.error
            ? (
                <div className="flex h-full w-full items-center justify-center text-text-tertiary">
                  <span className="system-sm-regular">
                    {t('skillSidebar.sqlitePreview.loadError')}
                  </span>
                </div>
              )
            : (tableState.data && tableState.data.values.length > 0)
                ? (
                    <DataTable
                      columns={tableState.data.columns}
                      values={tableState.data.values}
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
    </div>
  )
}

export default React.memo(SQLiteFilePreview)
