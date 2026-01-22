import type { SQLiteQueryResult } from '../../hooks/sqlite/types'
import { useEffect, useReducer } from 'react'

type TableState = {
  data: SQLiteQueryResult | null
  isLoading: boolean
  error: Error | null
}

type TableAction
  = | { type: 'reset' }
    | { type: 'loading' }
    | { type: 'success', data: SQLiteQueryResult | null }
    | { type: 'error', error: Error }

type UseSQLiteTableArgs = {
  selectedTable: string
  queryTable: (tableName: string, limit?: number) => Promise<SQLiteQueryResult | null>
}

const initialTableState: TableState = {
  data: null,
  isLoading: false,
  error: null,
}

export const useSQLiteTable = ({
  selectedTable,
  queryTable,
}: UseSQLiteTableArgs): TableState => {
  const [tableState, dispatch] = useReducer((current: TableState, action: TableAction): TableState => {
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
  }, initialTableState)

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

  return tableState
}
