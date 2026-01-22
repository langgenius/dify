import type { FC } from 'react'
import * as React from 'react'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useSQLiteDatabase } from '../../hooks/use-sqlite-database'
import TablePanel from './table-panel'
import TableSelector from './table-selector'

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
        const data = await queryTable(selectedTable)
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
      />
    </div>
  )
}

export default React.memo(SQLiteFilePreview)
