import { act, renderHook } from '@testing-library/react'
import { usePrefetchOnIntent } from './use-prefetch-on-intent'

describe('usePrefetchOnIntent', () => {
  it('disables prefetching until the user shows intent', () => {
    const { result } = renderHook(() => usePrefetchOnIntent())

    expect(result.current.prefetch).toBe(false)
  })

  it('restores the default prefetch behaviour on hover', () => {
    const { result } = renderHook(() => usePrefetchOnIntent())

    act(() => result.current.onMouseEnter())

    // `null` is App Router's default, not "never prefetch" — the link is now free
    // to prefetch, where `false` would have suppressed the hover prefetch too.
    expect(result.current.prefetch).toBeNull()
  })

  it('restores the default prefetch behaviour on keyboard focus', () => {
    const { result } = renderHook(() => usePrefetchOnIntent())

    act(() => result.current.onFocus())

    expect(result.current.prefetch).toBeNull()
  })

  it('keeps a stable object while intent has not changed', () => {
    const { result, rerender } = renderHook(() => usePrefetchOnIntent())
    const initial = result.current

    rerender()

    expect(result.current).toBe(initial)
  })
})
