import { act, renderHook } from '@testing-library/react'
import { useSerialAsyncCallback } from '../use-serial-async-callback'

describe('useSerialAsyncCallback', () => {
  it('should execute a synchronous function and return its result', async () => {
    const fn = vi.fn((..._args: number[]) => 42)
    const { result } = renderHook(() => useSerialAsyncCallback(fn))

    const value = await act(() => result.current(1, 2))

    expect(value).toBe(42)
    expect(fn).toHaveBeenCalledWith(1, 2)
  })

  it('should execute an async function and return its result', async () => {
    const fn = vi.fn(async (x: number) => x * 2)
    const { result } = renderHook(() => useSerialAsyncCallback(fn))

    const value = await act(() => result.current(5))

    expect(value).toBe(10)
  })

  it('should serialize concurrent calls sequentially', async () => {
    const order: number[] = []
    const fn = vi.fn(async (id: number, delay: number) => {
      await new Promise(resolve => setTimeout(resolve, delay))
      order.push(id)
      return id
    })

    const { result } = renderHook(() => useSerialAsyncCallback(fn))

    let r1: number | undefined
    let r2: number | undefined
    let r3: number | undefined

    await act(async () => {
      const p1 = result.current(1, 30)
      const p2 = result.current(2, 10)
      const p3 = result.current(3, 5)
      r1 = await p1
      r2 = await p2
      r3 = await p3
    })

    expect(order).toEqual([1, 2, 3])
    expect(r1).toBe(1)
    expect(r2).toBe(2)
    expect(r3).toBe(3)
  })

  it('should skip execution when shouldSkip returns true', async () => {
    const fn = vi.fn(async () => 'executed')
    const shouldSkip = vi.fn(() => true)
    const { result } = renderHook(() => useSerialAsyncCallback(fn, shouldSkip))

    const value = await act(() => result.current())

    expect(value).toBeUndefined()
    expect(fn).not.toHaveBeenCalled()
  })

  it('should execute when shouldSkip returns false', async () => {
    const fn = vi.fn(async () => 'executed')
    const shouldSkip = vi.fn(() => false)
    const { result } = renderHook(() => useSerialAsyncCallback(fn, shouldSkip))

    const value = await act(() => result.current())

    expect(value).toBe('executed')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('should continue queuing after a previous call rejects', async () => {
    let callCount = 0
    const fn = vi.fn(async () => {
      callCount++
      if (callCount === 1)
        throw new Error('fail')
      return 'ok'
    })

    const { result } = renderHook(() => useSerialAsyncCallback(fn))

    await act(async () => {
      await result.current().catch(() => {})
      const value = await result.current()
      expect(value).toBe('ok')
    })

    expect(fn).toHaveBeenCalledTimes(2)
  })
})
