import { renderHook, waitFor } from '@testing-library/react'
import { useSQLiteTable } from '../use-sqlite-table'

describe('useSQLiteTable', () => {
  it('should reset when no table is selected', () => {
    const queryTable = vi.fn()

    const { result } = renderHook(() => useSQLiteTable({
      selectedTable: '',
      queryTable,
    }))

    expect(queryTable).not.toHaveBeenCalled()
    expect(result.current).toEqual({
      data: null,
      isLoading: false,
      error: null,
    })
  })

  it('should load the selected table with the preview row limit', async () => {
    const queryTable = vi.fn().mockResolvedValue({
      columns: ['id'],
      values: [[1]],
    })

    const { result } = renderHook(() => useSQLiteTable({
      selectedTable: 'users',
      queryTable,
    }))

    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.data).toEqual({
      columns: ['id'],
      values: [[1]],
    }))

    expect(queryTable).toHaveBeenCalledWith('users', 1000)
    expect(result.current.error).toBeNull()
  })

  it('should surface query errors', async () => {
    const queryTable = vi.fn().mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useSQLiteTable({
      selectedTable: 'users',
      queryTable,
    }))

    await waitFor(() => expect(result.current.error?.message).toBe('boom'))
    expect(result.current.data).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('should wrap non-error rejections in an Error instance', async () => {
    const queryTable = vi.fn().mockRejectedValue('boom')

    const { result } = renderHook(() => useSQLiteTable({
      selectedTable: 'users',
      queryTable,
    }))

    await waitFor(() => expect(result.current.error?.message).toBe('boom'))
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('should ignore stale async results after the table changes', async () => {
    let resolveFirst!: (value: { columns: string[], values: number[][] }) => void
    const queryTable = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve
      }))
      .mockResolvedValueOnce({
        columns: ['id'],
        values: [[2]],
      })

    const { result, rerender } = renderHook(
      ({ selectedTable }) => useSQLiteTable({
        selectedTable,
        queryTable,
      }),
      {
        initialProps: {
          selectedTable: 'users',
        },
      },
    )

    rerender({ selectedTable: 'events' })
    resolveFirst({
      columns: ['id'],
      values: [[1]],
    })

    await waitFor(() => expect(result.current.data).toEqual({
      columns: ['id'],
      values: [[2]],
    }))
  })

  it('should ignore rejected requests after the selection resets', async () => {
    let rejectFirst!: (reason?: unknown) => void
    const queryTable = vi.fn().mockImplementation(() => new Promise((_, reject) => {
      rejectFirst = reject
    }))

    const { result, rerender } = renderHook(
      ({ selectedTable }) => useSQLiteTable({
        selectedTable,
        queryTable,
      }),
      {
        initialProps: {
          selectedTable: 'users',
        },
      },
    )

    rerender({ selectedTable: '' })
    rejectFirst(new Error('late failure'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.data).toBeNull()
  })
})
