import type { MemoryVFS } from 'wa-sqlite/src/examples/MemoryVFS.js'
import { useCallback, useEffect, useReducer, useRef } from 'react'

export type SQLiteValue = string | number | bigint | Uint8Array | null

export type SQLiteQueryResult = {
  columns: string[]
  values: SQLiteValue[][]
}

export type UseSQLiteDatabaseResult = {
  tables: string[]
  isLoading: boolean
  error: Error | null
  queryTable: (tableName: string, limit?: number) => Promise<SQLiteQueryResult | null>
}

type SQLiteModuleType = typeof import('wa-sqlite')
type SQLiteAPI = ReturnType<SQLiteModuleType['Factory']>
type SQLiteVFS = Parameters<SQLiteAPI['vfs_register']>[0]

type SQLiteClient = {
  sqlite3: ReturnType<SQLiteModuleType['Factory']>
  sqlite: SQLiteModuleType
  vfs: MemoryVFS
}

type SQLiteState = {
  tables: string[]
  isLoading: boolean
  error: Error | null
}

type SQLiteAction
  = | { type: 'reset' }
    | { type: 'loading' }
    | { type: 'success', tables: string[] }
    | { type: 'error', error: Error }

const TABLES_QUERY = 'SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name'
const DEFAULT_ROW_LIMIT = 200

let sqliteClientPromise: Promise<SQLiteClient> | null = null

function createTempFileName(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    return `preview-${crypto.randomUUID()}.db`
  return `preview-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
}

async function getSQLiteClient(): Promise<SQLiteClient> {
  if (!sqliteClientPromise) {
    sqliteClientPromise = (async () => {
      const [{ default: SQLiteESMFactory }, sqlite, { MemoryVFS }] = await Promise.all([
        import('wa-sqlite/dist/wa-sqlite.mjs'),
        import('wa-sqlite'),
        import('wa-sqlite/src/examples/MemoryVFS.js'),
      ])
      const sqliteModule = await SQLiteESMFactory()
      const sqlite3 = sqlite.Factory(sqliteModule)
      const vfs = new MemoryVFS()
      sqlite3.vfs_register(vfs as unknown as SQLiteVFS, false)
      return {
        sqlite3,
        sqlite,
        vfs,
      }
    })()
  }
  return sqliteClientPromise
}

export function useSQLiteDatabase(downloadUrl: string | undefined): UseSQLiteDatabaseResult {
  const [state, dispatch] = useReducer((current: SQLiteState, action: SQLiteAction): SQLiteState => {
    switch (action.type) {
      case 'reset':
        return {
          tables: [],
          isLoading: false,
          error: null,
        }
      case 'loading':
        return {
          ...current,
          isLoading: true,
          error: null,
          tables: [],
        }
      case 'success':
        return {
          tables: action.tables,
          isLoading: false,
          error: null,
        }
      case 'error':
        return {
          tables: [],
          isLoading: false,
          error: action.error,
        }
      default:
        return current
    }
  }, {
    tables: [],
    isLoading: false,
    error: null,
  })
  const dbRef = useRef<number | null>(null)
  const fileRef = useRef<string | null>(null)
  const clientRef = useRef<SQLiteClient | null>(null)
  const cacheRef = useRef<Map<string, SQLiteQueryResult>>(new Map())

  const closeDatabase = useCallback(async () => {
    const client = clientRef.current
    const db = dbRef.current
    const fileName = fileRef.current

    if (client && db !== null) {
      try {
        await client.sqlite3.close(db)
      }
      catch {
        // Ignore cleanup errors.
      }
    }

    if (client && fileName)
      client.vfs.mapNameToFile.delete(fileName)

    dbRef.current = null
    fileRef.current = null
    cacheRef.current.clear()
  }, [])

  useEffect(() => {
    if (!downloadUrl) {
      dispatch({ type: 'reset' })
      void closeDatabase()
      return
    }

    let cancelled = false
    const controller = new AbortController()

    const loadDatabase = async () => {
      dispatch({ type: 'loading' })

      try {
        const [client, response] = await Promise.all([
          getSQLiteClient(),
          fetch(downloadUrl, { signal: controller.signal }),
        ])

        if (cancelled)
          return

        if (!response.ok)
          throw new Error(`Failed to fetch database: ${response.status}`)

        const buffer = await response.arrayBuffer()
        if (cancelled)
          return

        await closeDatabase()

        const fileName = createTempFileName()
        client.vfs.mapNameToFile.set(fileName, {
          name: fileName,
          flags: 0,
          size: buffer.byteLength,
          data: buffer,
        })

        const db = await client.sqlite3.open_v2(
          fileName,
          client.sqlite.SQLITE_OPEN_READONLY,
          client.vfs.name,
        )

        if (cancelled) {
          await client.sqlite3.close(db)
          client.vfs.mapNameToFile.delete(fileName)
          return
        }

        clientRef.current = client
        dbRef.current = db
        fileRef.current = fileName

        const result = await client.sqlite3.execWithParams(db, TABLES_QUERY, [])
        const tableNames = result.rows.map(row => String(row[0]))
        dispatch({ type: 'success', tables: tableNames })
      }
      catch (err) {
        if (!cancelled) {
          dispatch({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) })
        }
      }
    }

    loadDatabase()

    return () => {
      cancelled = true
      controller.abort()
      void closeDatabase()
    }
  }, [downloadUrl, closeDatabase])

  const queryTable = useCallback(async (tableName: string, limit?: number): Promise<SQLiteQueryResult | null> => {
    const client = clientRef.current
    const db = dbRef.current

    if (!client || db === null || !tableName)
      return null

    if (!state.tables.includes(tableName))
      return null

    const rowLimit = Number.isFinite(limit) && limit && limit > 0
      ? Math.floor(limit)
      : DEFAULT_ROW_LIMIT
    const cacheKey = `${tableName}:${rowLimit}`
    const cached = cacheRef.current.get(cacheKey)
    if (cached)
      return cached

    const safeName = tableName.replaceAll('"', '""')
    const result = await client.sqlite3.execWithParams(
      db,
      `SELECT * FROM "${safeName}" LIMIT ${rowLimit}`,
      [],
    )
    const data: SQLiteQueryResult = {
      columns: result.columns,
      values: result.rows as SQLiteValue[][],
    }
    cacheRef.current.set(cacheKey, data)
    return data
  }, [state.tables])

  return {
    tables: state.tables,
    isLoading: state.isLoading,
    error: state.error,
    queryTable,
  }
}
