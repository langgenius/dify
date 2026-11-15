import type { GenRes } from '@/service/debug'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import useGenData from '../use-gen-data'

describe('useGenData', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('selects new versions and restores the chosen version per generator', () => {
    const versionOne = { modified: 'first version' } satisfies GenRes
    const versionTwo = { modified: 'second version' } satisfies GenRes
    const { result, unmount } = renderHook(() => useGenData({ storageKey: 'prompt' }))

    expect(result.current.versions).toEqual([])
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
    act(() => result.current.setCurrentVersionIndex(0))
    expect(result.current.current).toEqual(versionOne)
    unmount()
    const reopened = renderHook(() => useGenData({ storageKey: 'prompt' }))
    expect(reopened.result.current.versions).toEqual([versionOne, versionTwo])
    expect(reopened.result.current.current).toEqual(versionOne)
    const otherGenerator = renderHook(() => useGenData({ storageKey: 'code' }))
    expect(otherGenerator.result.current.versions).toEqual([])
  })
})
