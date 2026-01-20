import { RiHashtag, RiTextSnippet, RiTimeLine } from '@remixicon/react'
import { describe, expect, it } from 'vitest'
import { DataType } from '../types'
import { getIcon } from './get-icon'

describe('getIcon', () => {
  describe('Rendering', () => {
    it('should return RiTextSnippet for DataType.string', () => {
      const result = getIcon(DataType.string)
      expect(result).toBe(RiTextSnippet)
    })

    it('should return RiHashtag for DataType.number', () => {
      const result = getIcon(DataType.number)
      expect(result).toBe(RiHashtag)
    })

    it('should return RiTimeLine for DataType.time', () => {
      const result = getIcon(DataType.time)
      expect(result).toBe(RiTimeLine)
    })
  })

  describe('Edge Cases', () => {
    it('should return RiTextSnippet as fallback for unknown type', () => {
      const result = getIcon('unknown' as DataType)
      expect(result).toBe(RiTextSnippet)
    })

    it('should return RiTextSnippet for undefined type', () => {
      const result = getIcon(undefined as unknown as DataType)
      expect(result).toBe(RiTextSnippet)
    })

    it('should return RiTextSnippet for null type', () => {
      const result = getIcon(null as unknown as DataType)
      expect(result).toBe(RiTextSnippet)
    })

    it('should return RiTextSnippet for empty string type', () => {
      const result = getIcon('' as DataType)
      expect(result).toBe(RiTextSnippet)
    })
  })
})
