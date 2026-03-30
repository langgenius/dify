import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import useGenData from '../use-gen-data'

describe('useGenData', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('should initialize empty version state for a new storage key', () => {
    const { result } = renderHook(() => useGenData({ storageKey: 'prompt' }))

    expect(result.current.versions).toEqual([])
    expect(result.current.currentVersionIndex).toBe(0)
    expect(result.current.current).toBeUndefined()
  })

  it('should append versions and move the current index to the latest version', () => {
    const { result } = renderHook(() => useGenData({ storageKey: 'prompt' }))

    act(() => {
      result.current.addVersion({ modified: 'first' })
    })
    expect(result.current.versions).toEqual([{ modified: 'first' }])
    expect(result.current.currentVersionIndex).toBe(0)
    expect(result.current.current).toEqual({ modified: 'first' })

    act(() => {
      result.current.addVersion({ message: 'hint', modified: 'second' })
    })
    expect(result.current.versions).toEqual([
      { modified: 'first' },
      { message: 'hint', modified: 'second' },
    ])
    expect(result.current.currentVersionIndex).toBe(1)
    expect(result.current.current).toEqual({ message: 'hint', modified: 'second' })
  })

  it('should persist and restore versions by storage key', () => {
    const { result, unmount } = renderHook(() => useGenData({ storageKey: 'prompt' }))

    act(() => {
      result.current.addVersion({ modified: 'first' })
    })
    act(() => {
      result.current.addVersion({ modified: 'second' })
    })
    act(() => {
      result.current.setCurrentVersionIndex(0)
    })

    unmount()

    const { result: nextResult } = renderHook(() => useGenData({ storageKey: 'prompt' }))
    expect(nextResult.current.versions).toEqual([
      { modified: 'first' },
      { modified: 'second' },
    ])
    expect(nextResult.current.currentVersionIndex).toBe(0)
    expect(nextResult.current.current).toEqual({ modified: 'first' })
  })
})
