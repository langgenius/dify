import type { MemoryVFS } from 'wa-sqlite/src/examples/MemoryVFS.js'

type SQLiteModuleType = typeof import('wa-sqlite')

export type SQLiteValue = string | number | bigint | Uint8Array | null

export type SQLiteQueryResult = {
  columns: string[]
  values: SQLiteValue[][]
}

export type SQLiteAPI = ReturnType<SQLiteModuleType['Factory']>
export type SQLiteVFS = Parameters<SQLiteAPI['vfs_register']>[0]

export type SQLiteClient = {
  sqlite3: SQLiteAPI
  sqlite: SQLiteModuleType
  vfs: MemoryVFS
}

export type SQLiteState = {
  tables: string[]
  isLoading: boolean
  error: Error | null
}

export type SQLiteAction
  = | { type: 'reset' }
    | { type: 'loading' }
    | { type: 'success', tables: string[] }
    | { type: 'error', error: Error }
