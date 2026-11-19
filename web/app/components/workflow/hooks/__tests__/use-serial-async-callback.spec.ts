import { act, renderHook } from '@testing-library/react'
import { createDeferred } from '@/test/deferred'
import { useSerialAsyncCallback } from '../use-serial-async-callback'

it('starts queued calls only after their predecessor resolves and returns each result', async () => {
  const first = createDeferred<number>()
  const second = createDeferred<number>()
  const fn = vi
    .fn<(id: number) => number | Promise<number>>()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(30)
  const { result } = renderHook(() => useSerialAsyncCallback(fn))
  const calls = [result.current(1), result.current(2), result.current(3)]
  await act(async () => {})
  expect(fn).toHaveBeenCalledExactlyOnceWith(1)
  await act(async () => first.resolve(10))
  expect(fn.mock.calls).toEqual([[1], [2]])
  await act(async () => second.resolve(20))
  await expect(Promise.all(calls)).resolves.toEqual([10, 20, 30])
  expect(fn.mock.calls).toEqual([[1], [2], [3]])
})

it('skips rejected submissions without preventing later accepted calls', async () => {
  const fn = vi.fn((value: number) => value * 2)
  const { result, rerender } = renderHook(({ skip }) => useSerialAsyncCallback(fn, () => skip), {
    initialProps: { skip: true },
  })
  await expect(result.current(1)).resolves.toBeUndefined()
  expect(fn).not.toHaveBeenCalled()
  rerender({ skip: false })
  await expect(result.current(2)).resolves.toBe(4)
  expect(fn).toHaveBeenCalledExactlyOnceWith(2)
})

it('rejects a failed call while allowing an already queued successor to run', async () => {
  const first = createDeferred<string>()
  const error = new Error('fail')
  const fn = vi
    .fn<() => Promise<string>>()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce('ok')
  const { result } = renderHook(() => useSerialAsyncCallback(fn))
  const failed = expect(result.current()).rejects.toBe(error)
  const next = result.current()
  await act(async () => first.reject(error))
  await failed
  await expect(next).resolves.toBe('ok')
  expect(fn).toHaveBeenCalledTimes(2)
})
