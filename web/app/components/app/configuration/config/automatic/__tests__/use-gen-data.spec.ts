import type { GenRes } from '@/service/debug'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import useGenData from '../use-gen-data'

describe('useGenData', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('should start with an empty version list', () => {
    const { result } = renderHook(() => useGenData({ storageKey: 'prompt' }))

    expect(result.current.versions).toEqual([])
    expect(result.current.currentVersionIndex).toBe(0)
    expect(result.current.current).toBeUndefined()
  })

  it('should append versions and keep the latest one selected', () => {
    const versionOne = { modified: 'first version' } as GenRes
    const versionTwo = { modified: 'second version' } as GenRes
    const { result } = renderHook(() => useGenData({ storageKey: 'prompt' }))

    act(() => {
      result.current.addVersion(versionOne)
    })

    expect(result.current.versions).toEqual([versionOne])
    expect(result.current.current).toEqual(versionOne)

    act(() => {
      result.current.addVersion(versionTwo)
    })

    expect(result.current.versions).toEqual([versionOne, versionTwo])
    expect(result.current.currentVersionIndex).toBe(1)
    expect(result.current.current).toEqual(versionTwo)
  })
})
