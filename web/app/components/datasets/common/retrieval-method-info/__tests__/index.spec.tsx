import { RETRIEVE_METHOD } from '@/types/app'
import { retrievalIcon } from '../../../create/icons'
import { getIcon } from '../index'

// Mock icons
vi.mock('../../../create/icons', () => ({
  retrievalIcon: {
    vector: 'vector-icon.png',
    fullText: 'fulltext-icon.png',
    hybrid: 'hybrid-icon.png',
  },
}))

describe('RetrievalMethodInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getIcon utility', () => {
    it('should return correct icon for each type', () => {
      expect(getIcon(RETRIEVE_METHOD.semantic)).toBe(retrievalIcon.vector)
      expect(getIcon(RETRIEVE_METHOD.fullText)).toBe(retrievalIcon.fullText)
      expect(getIcon(RETRIEVE_METHOD.hybrid)).toBe(retrievalIcon.hybrid)
      expect(getIcon(RETRIEVE_METHOD.invertedIndex)).toBe(retrievalIcon.vector)
      expect(getIcon(RETRIEVE_METHOD.keywordSearch)).toBe(retrievalIcon.vector)
    })

    it('should return default vector icon for unknown type', () => {
      // Test fallback branch when type is not in the mapping
      const unknownType = 'unknown_method' as RETRIEVE_METHOD
      expect(getIcon(unknownType)).toBe(retrievalIcon.vector)
    })
  })
})
