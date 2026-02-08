import { renderHook } from '@testing-library/react'
import { useChunkStructure } from './hooks'
import { EffectColor } from './types'

// Note: react-i18next is globally mocked in vitest.setup.ts

describe('useChunkStructure', () => {
  describe('Hook Initialization', () => {
    it('should return options array', () => {
      const { result } = renderHook(() => useChunkStructure())

      expect(result.current.options).toBeDefined()
      expect(Array.isArray(result.current.options)).toBe(true)
    })

    it('should return exactly 3 options', () => {
      const { result } = renderHook(() => useChunkStructure())

      expect(result.current.options).toHaveLength(3)
    })
  })

  describe('General Option', () => {
    it('should have correct id for General option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const generalOption = result.current.options[0]
      expect(generalOption.id).toBe('text_model')
    })

    it('should have icon for General option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const generalOption = result.current.options[0]
      expect(generalOption.icon).toBeDefined()
    })

    it('should have correct iconActiveColor for General option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const generalOption = result.current.options[0]
      expect(generalOption.iconActiveColor).toBe('text-util-colors-indigo-indigo-600')
    })

    it('should have title for General option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const generalOption = result.current.options[0]
      expect(generalOption.title).toBe('General')
    })

    it('should have description for General option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const generalOption = result.current.options[0]
      expect(generalOption.description).toBeDefined()
    })

    it('should have indigo effectColor for General option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const generalOption = result.current.options[0]
      expect(generalOption.effectColor).toBe(EffectColor.indigo)
    })

    it('should have showEffectColor true for General option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const generalOption = result.current.options[0]
      expect(generalOption.showEffectColor).toBe(true)
    })
  })

  describe('Parent-Child Option', () => {
    it('should have correct id for Parent-Child option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const parentChildOption = result.current.options[1]
      expect(parentChildOption.id).toBe('hierarchical_model')
    })

    it('should have icon for Parent-Child option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const parentChildOption = result.current.options[1]
      expect(parentChildOption.icon).toBeDefined()
    })

    it('should have correct iconActiveColor for Parent-Child option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const parentChildOption = result.current.options[1]
      expect(parentChildOption.iconActiveColor).toBe('text-util-colors-blue-light-blue-light-500')
    })

    it('should have title for Parent-Child option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const parentChildOption = result.current.options[1]
      expect(parentChildOption.title).toBe('Parent-Child')
    })

    it('should have description for Parent-Child option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const parentChildOption = result.current.options[1]
      expect(parentChildOption.description).toBeDefined()
    })

    it('should have blueLight effectColor for Parent-Child option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const parentChildOption = result.current.options[1]
      expect(parentChildOption.effectColor).toBe(EffectColor.blueLight)
    })

    it('should have showEffectColor true for Parent-Child option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const parentChildOption = result.current.options[1]
      expect(parentChildOption.showEffectColor).toBe(true)
    })
  })

  describe('Q&A Option', () => {
    it('should have correct id for Q&A option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const qaOption = result.current.options[2]
      expect(qaOption.id).toBe('qa_model')
    })

    it('should have icon for Q&A option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const qaOption = result.current.options[2]
      expect(qaOption.icon).toBeDefined()
    })

    it('should have title for Q&A option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const qaOption = result.current.options[2]
      expect(qaOption.title).toBe('Q&A')
    })

    it('should have description for Q&A option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const qaOption = result.current.options[2]
      expect(qaOption.description).toBeDefined()
    })

    it('should not have effectColor for Q&A option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const qaOption = result.current.options[2]
      expect(qaOption.effectColor).toBeUndefined()
    })

    it('should not have showEffectColor for Q&A option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const qaOption = result.current.options[2]
      expect(qaOption.showEffectColor).toBeUndefined()
    })

    it('should not have iconActiveColor for Q&A option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const qaOption = result.current.options[2]
      expect(qaOption.iconActiveColor).toBeUndefined()
    })
  })

  describe('Options Structure', () => {
    it('should return options in correct order', () => {
      const { result } = renderHook(() => useChunkStructure())

      const ids = result.current.options.map(opt => opt.id)
      expect(ids).toEqual(['text_model', 'hierarchical_model', 'qa_model'])
    })

    it('should return all options with required id property', () => {
      const { result } = renderHook(() => useChunkStructure())

      result.current.options.forEach((option) => {
        expect(option.id).toBeDefined()
      })
    })

    it('should return all options with required title property', () => {
      const { result } = renderHook(() => useChunkStructure())

      result.current.options.forEach((option) => {
        expect(option.title).toBeDefined()
        expect(typeof option.title).toBe('string')
      })
    })

    it('should return all options with description property', () => {
      const { result } = renderHook(() => useChunkStructure())

      result.current.options.forEach((option) => {
        expect(option.description).toBeDefined()
      })
    })

    it('should return all options with icon property', () => {
      const { result } = renderHook(() => useChunkStructure())

      result.current.options.forEach((option) => {
        expect(option.icon).toBeDefined()
      })
    })
  })

  describe('Hook Stability', () => {
    it('should return consistent options on multiple renders', () => {
      const { result, rerender } = renderHook(() => useChunkStructure())

      const firstRenderOptions = result.current.options.map(opt => opt.id)
      rerender()
      const secondRenderOptions = result.current.options.map(opt => opt.id)

      expect(firstRenderOptions).toEqual(secondRenderOptions)
    })

    it('should return options with stable structure', () => {
      const { result, rerender } = renderHook(() => useChunkStructure())

      const firstLength = result.current.options.length
      rerender()
      const secondLength = result.current.options.length

      expect(firstLength).toBe(secondLength)
    })
  })
})
