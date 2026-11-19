import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import useHideLogic from '../use-hide-logic'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('installation window lifetime', () => {
  it('cancels the pending automatic close when the user hides an ongoing installation', async () => {
    const onClose = vi.fn()
    const { result } = renderHook(() => useHideLogic(onClose))
    act(() => result.current.handleStartToInstall())
    // Without a task trigger, folding falls back to closing immediately.
    act(() => result.current.foldAnimInto())
    expect(onClose).toHaveBeenCalledOnce()
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the original countdown through rerenders and calls the latest close callback', async () => {
    const initialOnClose = vi.fn()
    const latestOnClose = vi.fn()
    const { result, rerender } = renderHook(({ onClose }) => useHideLogic(onClose), {
      initialProps: { onClose: initialOnClose },
    })
    act(() => result.current.handleStartToInstall())
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    rerender({ onClose: latestOnClose })
    await act(() => vi.advanceTimersByTimeAsync(13_999))
    expect(initialOnClose).not.toHaveBeenCalled()
    expect(latestOnClose).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(latestOnClose).toHaveBeenCalledOnce()
    expect(initialOnClose).not.toHaveBeenCalled()
  })

  it('keeps the completed installation open until the user closes it', async () => {
    const onClose = vi.fn()
    const { result } = renderHook(() => useHideLogic(onClose))
    act(() => result.current.handleStartToInstall())
    // Starting and completing installation commit separately, as the async request does.
    act(() => result.current.setIsInstalling(false))
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    expect(onClose).not.toHaveBeenCalled()
    act(() => result.current.foldAnimInto())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('cancels the automatic close when the installation window unmounts', async () => {
    const onClose = vi.fn()
    const { result, unmount } = renderHook(() => useHideLogic(onClose))
    act(() => result.current.handleStartToInstall())
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    expect(onClose).not.toHaveBeenCalled()
  })
})
