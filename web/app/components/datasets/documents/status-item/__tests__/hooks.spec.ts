import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIndexStatus } from '../hooks'

// Explicit react-i18next mock so the test stays portable
// even if the global vitest.setup changes.

describe('useIndexStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Verify the hook returns all expected status keys
  it('should return all expected status keys', () => {
    const { result } = renderHook(() => useIndexStatus())

    const expectedKeys = ['queuing', 'indexing', 'paused', 'error', 'available', 'enabled', 'disabled', 'archived']
    const keys = Object.keys(result.current)
    expect(keys).toEqual(expect.arrayContaining(expectedKeys))
  })

  // Verify each status entry has the correct color
  describe('colors', () => {
    it('should return orange color for queuing', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.queuing.color).toBe('orange')
    })

    it('should return blue color for indexing', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.indexing.color).toBe('blue')
    })

    it('should return orange color for paused', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.paused.color).toBe('orange')
    })

    it('should return red color for error', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.error.color).toBe('red')
    })

    it('should return green color for available', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.available.color).toBe('green')
    })

    it('should return green color for enabled', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.enabled.color).toBe('green')
    })

    it('should return gray color for disabled', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.disabled.color).toBe('gray')
    })

    it('should return gray color for archived', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.archived.color).toBe('gray')
    })
  })

  // Verify each status entry has translated text (global mock returns ns.key format)
  describe('translated text', () => {
    it('should return translated text for queuing', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.queuing.text).toBe('datasetDocuments.list.status.queuing')
    })

    it('should return translated text for indexing', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.indexing.text).toBe('datasetDocuments.list.status.indexing')
    })

    it('should return translated text for paused', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.paused.text).toBe('datasetDocuments.list.status.paused')
    })

    it('should return translated text for error', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.error.text).toBe('datasetDocuments.list.status.error')
    })

    it('should return translated text for available', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.available.text).toBe('datasetDocuments.list.status.available')
    })

    it('should return translated text for enabled', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.enabled.text).toBe('datasetDocuments.list.status.enabled')
    })

    it('should return translated text for disabled', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.disabled.text).toBe('datasetDocuments.list.status.disabled')
    })

    it('should return translated text for archived', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.archived.text).toBe('datasetDocuments.list.status.archived')
    })
  })

  // Verify each entry has both color and text properties
  it('should return objects with color and text properties for every status', () => {
    const { result } = renderHook(() => useIndexStatus())

    for (const key of Object.keys(result.current) as Array<keyof typeof result.current>) {
      expect(result.current[key]).toHaveProperty('color')
      expect(result.current[key]).toHaveProperty('text')
      expect(typeof result.current[key].color).toBe('string')
      expect(typeof result.current[key].text).toBe('string')
    }
  })
})
