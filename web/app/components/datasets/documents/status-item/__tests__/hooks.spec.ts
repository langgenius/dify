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

    const expectedKeys = [
      'queuing',
      'indexing',
      'paused',
      'error',
      'available',
      'enabled',
      'disabled',
      'archived',
    ]
    const keys = Object.keys(result.current)
    expect(keys).toEqual(expect.arrayContaining(expectedKeys))
  })

  describe('status variants', () => {
    it('should return warning status for queuing', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.queuing.status).toBe('warning')
    })

    it('should return normal status for indexing', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.indexing.status).toBe('normal')
    })

    it('should return warning status for paused', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.paused.status).toBe('warning')
    })

    it('should return error status for error', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.error.status).toBe('error')
    })

    it('should return success status for available', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.available.status).toBe('success')
    })

    it('should return success status for enabled', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.enabled.status).toBe('success')
    })

    it('should return disabled status for disabled', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.disabled.status).toBe('disabled')
    })

    it('should return disabled status for archived', () => {
      const { result } = renderHook(() => useIndexStatus())
      expect(result.current.archived.status).toBe('disabled')
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

  it('should return objects with status and text properties for every status', () => {
    const { result } = renderHook(() => useIndexStatus())

    for (const key of Object.keys(result.current) as Array<keyof typeof result.current>) {
      expect(result.current[key]).toHaveProperty('status')
      expect(result.current[key]).toHaveProperty('text')
      expect(typeof result.current[key].status).toBe('string')
      expect(typeof result.current[key].text).toBe('string')
    }
  })
})
