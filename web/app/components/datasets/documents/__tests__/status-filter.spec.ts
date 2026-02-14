import { beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeStatusForQuery, sanitizeStatusValue } from '../status-filter'

vi.mock('@/models/datasets', () => ({
  DisplayStatusList: [
    'queuing',
    'indexing',
    'paused',
    'error',
    'available',
    'enabled',
    'disabled',
    'archived',
  ],
}))

describe('status-filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Tests for sanitizeStatusValue
  describe('sanitizeStatusValue', () => {
    // Falsy inputs should return 'all'
    describe('falsy inputs', () => {
      it('should return all when value is undefined', () => {
        expect(sanitizeStatusValue(undefined)).toBe('all')
      })

      it('should return all when value is null', () => {
        expect(sanitizeStatusValue(null)).toBe('all')
      })

      it('should return all when value is empty string', () => {
        expect(sanitizeStatusValue('')).toBe('all')
      })
    })

    // Known status values should be returned as-is (lowercased)
    describe('known status values', () => {
      it('should return all when value is all', () => {
        expect(sanitizeStatusValue('all')).toBe('all')
      })

      it.each([
        'queuing',
        'indexing',
        'paused',
        'error',
        'available',
        'enabled',
        'disabled',
        'archived',
      ])('should return %s when value is %s', (status) => {
        expect(sanitizeStatusValue(status)).toBe(status)
      })

      it('should handle uppercase known values by normalizing to lowercase', () => {
        expect(sanitizeStatusValue('QUEUING')).toBe('queuing')
        expect(sanitizeStatusValue('Available')).toBe('available')
        expect(sanitizeStatusValue('ALL')).toBe('all')
      })
    })

    // URL alias resolution
    describe('URL aliases', () => {
      it('should resolve active to available', () => {
        expect(sanitizeStatusValue('active')).toBe('available')
      })

      it('should resolve Active (uppercase) to available', () => {
        expect(sanitizeStatusValue('Active')).toBe('available')
      })

      it('should resolve ACTIVE to available', () => {
        expect(sanitizeStatusValue('ACTIVE')).toBe('available')
      })
    })

    // Unknown values should fall back to 'all'
    describe('unknown values', () => {
      it('should return all when value is unknown', () => {
        expect(sanitizeStatusValue('unknown')).toBe('all')
      })

      it('should return all when value is an arbitrary string', () => {
        expect(sanitizeStatusValue('foobar')).toBe('all')
      })

      it('should return all when value is a numeric string', () => {
        expect(sanitizeStatusValue('123')).toBe('all')
      })
    })
  })

  // Tests for normalizeStatusForQuery
  describe('normalizeStatusForQuery', () => {
    // When sanitized value is 'all', should return 'all'
    describe('all status', () => {
      it('should return all when value is undefined', () => {
        expect(normalizeStatusForQuery(undefined)).toBe('all')
      })

      it('should return all when value is null', () => {
        expect(normalizeStatusForQuery(null)).toBe('all')
      })

      it('should return all when value is empty string', () => {
        expect(normalizeStatusForQuery('')).toBe('all')
      })

      it('should return all when value is all', () => {
        expect(normalizeStatusForQuery('all')).toBe('all')
      })

      it('should return all when value is unknown (sanitized to all)', () => {
        expect(normalizeStatusForQuery('unknown')).toBe('all')
      })
    })

    // Query alias resolution: enabled -> available
    describe('query aliases', () => {
      it('should resolve enabled to available', () => {
        expect(normalizeStatusForQuery('enabled')).toBe('available')
      })

      it('should resolve Enabled (mixed case) to available', () => {
        expect(normalizeStatusForQuery('Enabled')).toBe('available')
      })
    })

    // Non-aliased known values should pass through
    describe('non-aliased known values', () => {
      it.each([
        'queuing',
        'indexing',
        'paused',
        'error',
        'available',
        'disabled',
        'archived',
      ])('should return %s as-is when not aliased', (status) => {
        expect(normalizeStatusForQuery(status)).toBe(status)
      })
    })

    // URL alias flows through sanitize first, then query alias
    describe('combined alias resolution', () => {
      it('should resolve active through URL alias to available', () => {
        // active -> sanitizeStatusValue -> available -> no query alias for available -> available
        expect(normalizeStatusForQuery('active')).toBe('available')
      })
    })
  })
})
