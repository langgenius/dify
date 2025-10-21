import { isSupportMCP } from './plugin-version-feature'

describe('plugin-version-feature', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('isSupportMCP', () => {
    it('should call isEqualOrLaterThanVersion with the correct parameters', () => {
      expect(isSupportMCP('0.0.3')).toBe(true)
      expect(isSupportMCP('1.0.0')).toBe(true)
    })

    it('should return true when version is equal to the supported MCP version', () => {
      const mockVersion = '0.0.2'
      const result = isSupportMCP(mockVersion)
      expect(result).toBe(true)
    })

    it('should return false when version is less than the supported MCP version', () => {
      const mockVersion = '0.0.1'
      const result = isSupportMCP(mockVersion)
      expect(result).toBe(false)
    })
  })
})
