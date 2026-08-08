import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useResetOnChange } from '../use-reset-on-change'

type Schema = {
  variable: string
  reset_on_change?: string[]
}

describe('useResetOnChange', () => {
  const schemas: Schema[] = [
    { variable: 'source' },
    { variable: 'dependent', reset_on_change: ['source'] },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should report dependent schemas when a watched sibling changes', () => {
    const onReset = vi.fn()
    const { rerender } = renderHook(({ value }) => useResetOnChange({ schemas, value, onReset }), {
      initialProps: { value: { source: 'a', dependent: 'selected' } },
    })

    rerender({ value: { source: 'b', dependent: 'selected' } })

    expect(onReset).toHaveBeenCalledWith([schemas[1]])
  })

  it('should not report a dependent field when that field changes in the same update', () => {
    const onReset = vi.fn()
    const { rerender } = renderHook(({ value }) => useResetOnChange({ schemas, value, onReset }), {
      initialProps: { value: { source: 'a', dependent: 'selected' } },
    })

    rerender({ value: { source: 'b', dependent: 'manually-updated' } })

    expect(onReset).not.toHaveBeenCalled()
  })

  it('should treat removed sibling values as changes', () => {
    const onReset = vi.fn()
    const { rerender } = renderHook(({ value }) => useResetOnChange({ schemas, value, onReset }), {
      initialProps: { value: { source: 'a', dependent: 'selected' } as Record<string, string> },
    })

    rerender({ value: { dependent: 'selected' } })

    expect(onReset).toHaveBeenCalledWith([schemas[1]])
  })
})
