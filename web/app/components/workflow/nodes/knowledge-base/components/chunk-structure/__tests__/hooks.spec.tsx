import { render, renderHook } from '@testing-library/react'
import { ChunkStructureEnum } from '../../../types'
import { useChunkStructure } from '../hooks'

const renderIcon = (icon: ReturnType<typeof useChunkStructure>['options'][number]['icon'], isActive: boolean) => {
  if (typeof icon !== 'function')
    throw new Error('expected icon renderer')

  return icon(isActive)
}

describe('useChunkStructure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The hook should expose ordered options and a lookup map for every chunk structure variant.
  describe('Options', () => {
    it('should return all chunk structure options and map them by id', () => {
      const { result } = renderHook(() => useChunkStructure())

      expect(result.current.options).toHaveLength(3)
      expect(result.current.options.map(option => option.id)).toEqual([
        ChunkStructureEnum.general,
        ChunkStructureEnum.parent_child,
        ChunkStructureEnum.question_answer,
      ])
      expect(result.current.optionMap[ChunkStructureEnum.general].title).toBe('datasetCreation.stepTwo.general')
      expect(result.current.optionMap[ChunkStructureEnum.parent_child].title).toBe('datasetCreation.stepTwo.parentChild')
      expect(result.current.optionMap[ChunkStructureEnum.question_answer].title).toBe('Q&A')
    })

    it('should expose active and inactive icon renderers for every option', () => {
      const { result } = renderHook(() => useChunkStructure())

      const generalInactive = render(<>{renderIcon(result.current.optionMap[ChunkStructureEnum.general].icon, false)}</>).container.firstChild as HTMLElement
      const generalActive = render(<>{renderIcon(result.current.optionMap[ChunkStructureEnum.general].icon, true)}</>).container.firstChild as HTMLElement
      const parentChildActive = render(<>{renderIcon(result.current.optionMap[ChunkStructureEnum.parent_child].icon, true)}</>).container.firstChild as HTMLElement
      const questionAnswerActive = render(<>{renderIcon(result.current.optionMap[ChunkStructureEnum.question_answer].icon, true)}</>).container.firstChild as HTMLElement

      expect(generalInactive).toHaveClass('text-text-tertiary')
      expect(generalActive).toHaveClass('text-util-colors-indigo-indigo-600')
      expect(parentChildActive).toHaveClass('text-util-colors-blue-light-blue-light-500')
      expect(questionAnswerActive).toHaveClass('text-util-colors-teal-teal-600')
    })
  })
})
