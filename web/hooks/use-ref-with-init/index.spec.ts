import { renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, expectTypeOf, it, vi } from 'vite-plus/test'
import { useRefWithInit } from './index'

describe('useRefWithInit', () => {
  it('preserves the ref and initial value when the initializer and argument change', () => {
    const init = vi.fn((value: number) => ({ value }))
    const replacementInit = vi.fn((value: number) => ({ value }))
    const { result, rerender } = renderHook(
      ({ initializer, value }) => useRefWithInit(initializer, value),
      { initialProps: { initializer: init, value: 1 } },
    )
    const ref = result.current
    const initialValue = ref.current

    rerender({ initializer: replacementInit, value: 2 })

    expect(result.current).toBe(ref)
    expect(result.current.current).toBe(initialValue)
    expect(result.current.current).toEqual({ value: 1 })
    expect(init).toHaveBeenCalledExactlyOnceWith(1)
    expect(replacementInit).not.toHaveBeenCalled()
    expectTypeOf(result.current.current).toEqualTypeOf<{ value: number }>()
  })

  it.each([null, undefined])('accepts %s as an initialized value', (value) => {
    const init = vi.fn(() => value)
    const { result, rerender } = renderHook(() => useRefWithInit(init))

    rerender()

    expect(result.current.current).toBe(value)
    expect(init).toHaveBeenCalledTimes(1)
  })

  it('preserves explicit ref updates, including clearing the value', () => {
    const init = vi.fn((): number | null => 1)
    const { result, rerender } = renderHook(() => useRefWithInit(init))
    expectTypeOf(result.current.current).toEqualTypeOf<number | null>()

    result.current.current = 2
    rerender()
    expect(result.current.current).toBe(2)

    result.current.current = null
    rerender()
    expect(result.current.current).toBeNull()
    expect(init).toHaveBeenCalledTimes(1)
  })

  it('keeps committed ref identity across rerenders in Strict Mode', () => {
    const { result, rerender } = renderHook(() => useRefWithInit(() => new Map<string, number>()), {
      wrapper: StrictMode,
    })
    const ref = result.current
    const map = ref.current
    map.set('count', 1)

    rerender()

    expect(result.current).toBe(ref)
    expect(result.current.current).toBe(map)
    expect(result.current.current.get('count')).toBe(1)
  })
})
