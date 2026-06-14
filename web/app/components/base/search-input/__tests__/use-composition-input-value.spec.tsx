import { act, renderHook } from '@testing-library/react'
import { useCompositionInputValue } from '../use-composition-input-value'

describe('useCompositionInputValue', () => {
  it('should call onValueChange immediately when not composing', () => {
    const onValueChange = vi.fn()

    const { result } = renderHook(() => useCompositionInputValue({
      value: '',
      onValueChange,
    }))

    act(() => {
      result.current.onValueChange('query')
    })

    expect(onValueChange).toHaveBeenCalledWith('query')
  })

  it('should defer value changes until composition ends', () => {
    const onValueChange = vi.fn()

    const { result } = renderHook(() => useCompositionInputValue({
      value: 'initial',
      onValueChange,
    }))

    act(() => {
      result.current.onCompositionStart()
    })

    act(() => {
      result.current.onValueChange('final')
    })

    expect(result.current.value).toBe('final')
    expect(onValueChange).not.toHaveBeenCalled()

    act(() => {
      result.current.onCompositionEnd('final')
    })

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('final')
  })

  it('should ignore the duplicate change event after a composition commit', () => {
    const onValueChange = vi.fn()

    const { result } = renderHook(() => useCompositionInputValue({
      value: 'initial',
      onValueChange,
    }))

    act(() => {
      result.current.onCompositionStart()
      result.current.onValueChange('final')
      result.current.onCompositionEnd('final')
      result.current.onValueChange('final')
    })

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('final')
  })

  it('should reset pending composition without committing stale text', () => {
    const onValueChange = vi.fn()

    const { result } = renderHook(() => useCompositionInputValue({
      value: 'initial',
      onValueChange,
    }))

    act(() => {
      result.current.onCompositionStart()
      result.current.onValueChange('final')
      result.current.resetComposition()
      result.current.onCompositionEnd('final')
    })

    expect(result.current.value).toBe('initial')
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('should stop composing when the external value changes', () => {
    const onValueChange = vi.fn()

    const { result, rerender } = renderHook(
      ({ value }) => useCompositionInputValue({
        value,
        onValueChange,
      }),
      {
        initialProps: { value: 'initial' },
      },
    )

    act(() => {
      result.current.onCompositionStart()
      result.current.onValueChange('final')
    })

    rerender({ value: '' })

    expect(result.current.value).toBe('')

    act(() => {
      result.current.onCompositionEnd('final')
    })

    expect(onValueChange).not.toHaveBeenCalled()
  })
})
