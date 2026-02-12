import { act, renderHook } from '@testing-library/react'
import { ValidatedStatus } from './declarations'
import { useValidate } from './hooks'

describe('useValidate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should clear validation state when before returns false', async () => {
    const { result } = renderHook(() => useValidate({ apiKey: 'value' }))

    act(() => {
      result.current[0]({ before: () => false })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(result.current[1]).toBe(false)
    expect(result.current[2]).toEqual({})
  })

  it('should expose success status after a successful validation', async () => {
    const run = vi.fn().mockResolvedValue({ status: ValidatedStatus.Success })
    const { result } = renderHook(() => useValidate({ apiKey: 'value' }))

    act(() => {
      result.current[0]({
        before: () => true,
        run,
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(result.current[1]).toBe(false)
    expect(result.current[2]).toEqual({ status: ValidatedStatus.Success })
  })

  it('should expose error status and message when validation fails', async () => {
    const run = vi.fn().mockResolvedValue({ status: ValidatedStatus.Error, message: 'bad-key' })
    const { result } = renderHook(() => useValidate({ apiKey: 'value' }))

    act(() => {
      result.current[0]({
        before: () => true,
        run,
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(result.current[1]).toBe(false)
    expect(result.current[2]).toEqual({ status: ValidatedStatus.Error, message: 'bad-key' })
  })

  it('should keep validating state true when run is not provided', async () => {
    const { result } = renderHook(() => useValidate({ apiKey: 'value' }))

    act(() => {
      result.current[0]({ before: () => true })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(result.current[1]).toBe(true)
    expect(result.current[2]).toEqual({})
  })
})
