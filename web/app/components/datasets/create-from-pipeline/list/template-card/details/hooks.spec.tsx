import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChunkingMode } from '@/models/datasets'
import { useChunkStructureConfig } from './hooks'
import { EffectColor } from './types'

// ============================================================================
// useChunkStructureConfig Hook Tests
// ============================================================================

describe('useChunkStructureConfig', () => {
  // --------------------------------------------------------------------------
  // Return Value Tests
  // --------------------------------------------------------------------------
  describe('Return Value', () => {
    it('should return config object', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current).toBeDefined()
      expect(typeof result.current).toBe('object')
    })

    it('should have config for text chunking mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.text]).toBeDefined()
    })

    it('should have config for parent-child chunking mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.parentChild]).toBeDefined()
    })

    it('should have config for qa chunking mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.qa]).toBeDefined()
    })
  })

  // --------------------------------------------------------------------------
  // Text/General Config Tests
  // --------------------------------------------------------------------------
  describe('Text/General Config', () => {
    it('should have title for text mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.text].title).toBe('General')
    })

    it('should have description for text mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.text].description).toBeDefined()
    })

    it('should have icon for text mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.text].icon).toBeDefined()
    })

    it('should have indigo effect color for text mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.text].effectColor).toBe(EffectColor.indigo)
    })
  })

  // --------------------------------------------------------------------------
  // Parent-Child Config Tests
  // --------------------------------------------------------------------------
  describe('Parent-Child Config', () => {
    it('should have title for parent-child mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.parentChild].title).toBe('Parent-Child')
    })

    it('should have description for parent-child mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.parentChild].description).toBeDefined()
    })

    it('should have icon for parent-child mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.parentChild].icon).toBeDefined()
    })

    it('should have blueLight effect color for parent-child mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.parentChild].effectColor).toBe(EffectColor.blueLight)
    })
  })

  // --------------------------------------------------------------------------
  // Q&A Config Tests
  // --------------------------------------------------------------------------
  describe('Q&A Config', () => {
    it('should have title for qa mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.qa].title).toBe('Q&A')
    })

    it('should have description for qa mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.qa].description).toBeDefined()
    })

    it('should have icon for qa mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.qa].icon).toBeDefined()
    })

    it('should have green effect color for qa mode', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      expect(result.current[ChunkingMode.qa].effectColor).toBe(EffectColor.green)
    })
  })

  // --------------------------------------------------------------------------
  // Option Structure Tests
  // --------------------------------------------------------------------------
  describe('Option Structure', () => {
    it('should have all required fields in each option', () => {
      const { result } = renderHook(() => useChunkStructureConfig())

      Object.values(result.current).forEach((option) => {
        expect(option).toHaveProperty('icon')
        expect(option).toHaveProperty('title')
        expect(option).toHaveProperty('description')
        expect(option).toHaveProperty('effectColor')
      })
    })

    it('should cover all ChunkingMode values', () => {
      const { result } = renderHook(() => useChunkStructureConfig())
      const modes = Object.values(ChunkingMode)

      modes.forEach((mode) => {
        expect(result.current[mode]).toBeDefined()
      })
    })
  })
})
