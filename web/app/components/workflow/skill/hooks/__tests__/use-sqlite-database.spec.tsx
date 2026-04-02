import {
  act,
  renderHook,
  waitFor,
} from '@testing-library/react'

const mocks = vi.hoisted(() => {
  class MemoryVFS {
    name = 'memory'
    mapNameToFile = new Map<string, {
      name: string
      flags: number
      size: number
      data: ArrayBuffer
    }>()

    constructor() {
      mocks.vfsInstances.push(this)
    }
  }

  return {
    fetch: vi.fn<typeof fetch>(),
    sqliteFactory: vi.fn(),
    sqliteESMFactory: vi.fn(async () => ({ wasm: true })),
    execWithParams: vi.fn(),
    openV2: vi.fn(),
    close: vi.fn(),
    vfsRegister: vi.fn(),
    vfsInstances: [] as MemoryVFS[],
    MemoryVFS,
  }
})

vi.mock('wa-sqlite/dist/wa-sqlite.mjs', () => ({
  default: () => mocks.sqliteESMFactory(),
}))

vi.mock('wa-sqlite', () => ({
  Factory: () => ({
    execWithParams: mocks.execWithParams,
    open_v2: mocks.openV2,
    close: mocks.close,
    vfs_register: mocks.vfsRegister,
  }),
  SQLITE_OPEN_READONLY: 1,
}))

vi.mock('wa-sqlite/src/examples/MemoryVFS.js', () => ({
  MemoryVFS: mocks.MemoryVFS,
}))

describe('useSQLiteDatabase', () => {
  type HookProps = {
    url: string | undefined
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.vfsInstances.length = 0
    vi.stubGlobal('fetch', mocks.fetch)
    vi.stubGlobal('crypto', {
      randomUUID: () => 'uuid-1',
    })

    mocks.openV2.mockResolvedValue(99)
    mocks.close.mockResolvedValue(undefined)
    mocks.execWithParams.mockImplementation(async (_db: number, sql: string) => {
      if (sql.includes('sqlite_master')) {
        return {
          columns: ['name'],
          rows: [['users'], ['empty']],
        }
      }

      if (sql === 'SELECT * FROM "users" LIMIT 5') {
        return {
          columns: ['id', 'name'],
          rows: [[1, 'Ada']],
        }
      }

      if (sql === 'SELECT * FROM "users" LIMIT 2') {
        return {
          columns: ['id', 'name'],
          rows: [[1, 'Ada']],
        }
      }

      if (sql === 'SELECT * FROM "empty"') {
        return {
          columns: [],
          rows: [],
        }
      }

      if (sql === 'PRAGMA table_info("empty")') {
        return {
          columns: ['cid', 'name'],
          rows: [[0, 'id'], [1, 'name']],
        }
      }

      return {
        columns: ['id'],
        rows: [],
      }
    })
  })

  const importHook = async () => {
    vi.resetModules()
    const hookModule = await import('../use-sqlite-database')
    const constantsModule = await import('../sqlite/constants')
    return {
      useSQLiteDatabase: hookModule.useSQLiteDatabase,
      TABLES_QUERY: constantsModule.TABLES_QUERY,
    }
  }

  it('should load tables and query cached table data', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as unknown as Response)

    const { useSQLiteDatabase, TABLES_QUERY } = await importHook()

    const { result } = renderHook(() => useSQLiteDatabase('https://example.com/demo.db'))

    await waitFor(() => expect(result.current.tables).toEqual(['users', 'empty']))
    expect(mocks.fetch).toHaveBeenCalledWith('https://example.com/demo.db', { signal: expect.any(AbortSignal) })
    expect(mocks.execWithParams).toHaveBeenCalledWith(99, TABLES_QUERY, [])

    const first = await act(async () => result.current.queryTable('users', 5))
    expect(first).toEqual({
      columns: ['id', 'name'],
      values: [[1, 'Ada']],
    })

    const second = await act(async () => result.current.queryTable('users', 5))
    expect(second).toEqual(first)
    expect(mocks.execWithParams).toHaveBeenCalledTimes(2)
  })

  it('should derive columns from pragma output when a table has no selected columns', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as unknown as Response)

    const { useSQLiteDatabase } = await importHook()
    const { result } = renderHook(() => useSQLiteDatabase('https://example.com/demo.db'))

    await waitFor(() => expect(result.current.tables).toContain('empty'))

    const data = await act(async () => result.current.queryTable('empty'))

    expect(data).toEqual({
      columns: ['id', 'name'],
      values: [],
    })
  })

  it('should return null when querying an unknown table or before initialization', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as unknown as Response)

    const { useSQLiteDatabase } = await importHook()
    const { result } = renderHook(() => useSQLiteDatabase('https://example.com/demo.db'))

    expect(await act(async () => result.current.queryTable('users'))).toBeNull()

    await waitFor(() => expect(result.current.tables).toEqual(['users', 'empty']))
    expect(await act(async () => result.current.queryTable('missing'))).toBeNull()
  })

  it('should surface fetch errors and reset when the url is removed', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        arrayBuffer: vi.fn(),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      } as unknown as Response)

    const { useSQLiteDatabase } = await importHook()

    const { result, rerender } = renderHook(
      ({ url }: HookProps) => useSQLiteDatabase(url),
      {
        initialProps: {
          url: 'https://example.com/broken.db',
        } as HookProps,
      },
    )

    await waitFor(() => expect(result.current.error?.message).toBe('Failed to fetch database: 500'))

    rerender({ url: 'https://example.com/demo.db' } as HookProps)
    await waitFor(() => expect(result.current.tables).toEqual(['users', 'empty']))

    rerender({ url: undefined } as HookProps)
    await waitFor(() => expect(result.current.tables).toEqual([]))
    expect(mocks.close).toHaveBeenCalled()
  })

  it('should use a fallback temporary file name when crypto.randomUUID is unavailable', async () => {
    vi.stubGlobal('crypto', undefined)
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    mocks.fetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as unknown as Response)

    const { useSQLiteDatabase } = await importHook()
    const { result } = renderHook(() => useSQLiteDatabase('https://example.com/fallback.db'))

    await waitFor(() => expect(result.current.tables).toEqual(['users', 'empty']))
    expect(mocks.openV2.mock.calls[0][0]).toMatch(/^preview-1700000000000-/)
  })

  it('should ignore a resolved fetch when the hook is cancelled before the response arrives', async () => {
    let resolveFetch!: (value: Response) => void
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    mocks.fetch.mockReturnValue(fetchPromise)

    const { useSQLiteDatabase } = await importHook()
    const { result, rerender } = renderHook(
      ({ url }: HookProps) => useSQLiteDatabase(url),
      { initialProps: { url: 'https://example.com/cancel.db' } as HookProps },
    )

    rerender({ url: undefined } as HookProps)
    resolveFetch({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as unknown as Response)

    await waitFor(() => expect(result.current.tables).toEqual([]))
    expect(mocks.openV2).not.toHaveBeenCalled()
  })

  it('should ignore an array buffer that resolves after cancellation', async () => {
    let resolveArrayBuffer!: (value: ArrayBuffer) => void
    const arrayBufferMock = vi.fn().mockImplementation(() => new Promise<ArrayBuffer>((resolve) => {
      resolveArrayBuffer = resolve
    }))
    mocks.fetch.mockResolvedValue({
      ok: true,
      arrayBuffer: arrayBufferMock,
    } as unknown as Response)

    const { useSQLiteDatabase } = await importHook()
    const { result, rerender } = renderHook(
      ({ url }: HookProps) => useSQLiteDatabase(url),
      { initialProps: { url: 'https://example.com/cancel-buffer.db' } as HookProps },
    )

    await waitFor(() => expect(arrayBufferMock).toHaveBeenCalledTimes(1))
    rerender({ url: undefined } as HookProps)
    resolveArrayBuffer(new ArrayBuffer(8))

    await waitFor(() => expect(result.current.tables).toEqual([]))
    expect(mocks.openV2).not.toHaveBeenCalled()
  })

  it('should close a database opened after cancellation and remove its temp file', async () => {
    let resolveOpen!: (value: number) => void
    mocks.fetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as unknown as Response)
    mocks.openV2.mockImplementationOnce(() => new Promise<number>((resolve) => {
      resolveOpen = resolve
    }))

    const { useSQLiteDatabase } = await importHook()
    const { result, rerender } = renderHook(
      ({ url }: HookProps) => useSQLiteDatabase(url),
      { initialProps: { url: 'https://example.com/cancel-open.db' } as HookProps },
    )

    await waitFor(() => expect(mocks.openV2).toHaveBeenCalledTimes(1))
    rerender({ url: undefined } as HookProps)
    resolveOpen(777)

    await waitFor(() => expect(result.current.tables).toEqual([]))
    expect(mocks.close).toHaveBeenCalledWith(777)
    expect(mocks.vfsInstances.at(-1)?.mapNameToFile.size).toBe(0)
  })

  it('should wrap non-error failures when initialization rejects', async () => {
    mocks.fetch.mockRejectedValue('network failure')

    const { useSQLiteDatabase } = await importHook()
    const { result } = renderHook(() => useSQLiteDatabase('https://example.com/non-error.db'))

    await waitFor(() => expect(result.current.error?.message).toBe('network failure'))
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('should ignore rejected initialization after the hook has been cancelled', async () => {
    let rejectFetch!: (reason?: unknown) => void
    const fetchPromise = new Promise<Response>((_, reject) => {
      rejectFetch = reject
    })
    mocks.fetch.mockReturnValue(fetchPromise)

    const { useSQLiteDatabase } = await importHook()
    const { result, rerender } = renderHook(
      ({ url }: HookProps) => useSQLiteDatabase(url),
      { initialProps: { url: 'https://example.com/cancel-error.db' } as HookProps },
    )

    rerender({ url: undefined } as HookProps)
    rejectFetch(new Error('late failure'))

    await waitFor(() => expect(result.current.tables).toEqual([]))
    expect(result.current.error).toBeNull()
  })
})
