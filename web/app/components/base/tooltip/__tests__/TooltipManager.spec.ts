import { tooltipManager } from '../TooltipManager'

describe('TooltipManager', () => {
  // Test the singleton instance directly
  let manager: typeof tooltipManager

  beforeEach(() => {
    // Get fresh reference to the singleton
    manager = tooltipManager
    // Clean up any active tooltip by calling closeActiveTooltip
    // This ensures each test starts with a clean state
    manager.closeActiveTooltip()
  })

  describe('register', () => {
    it('should register a close function', () => {
      const closeFn = vi.fn()
      manager.register(closeFn)
      expect(closeFn).not.toHaveBeenCalled()
    })

    it('should call the existing close function when registering a new one', () => {
      const firstCloseFn = vi.fn()
      const secondCloseFn = vi.fn()

      manager.register(firstCloseFn)
      manager.register(secondCloseFn)

      expect(firstCloseFn).toHaveBeenCalledTimes(1)
      expect(secondCloseFn).not.toHaveBeenCalled()
    })

    it('should replace the active closer with the new one', () => {
      const firstCloseFn = vi.fn()
      const secondCloseFn = vi.fn()

      // Register first function
      manager.register(firstCloseFn)

      // Register second function - this should call firstCloseFn and replace it
      manager.register(secondCloseFn)

      // Verify firstCloseFn was called during register (replacement behavior)
      expect(firstCloseFn).toHaveBeenCalledTimes(1)

      // Now close the active tooltip - this should call secondCloseFn
      manager.closeActiveTooltip()

      // Verify secondCloseFn was called, not firstCloseFn
      expect(secondCloseFn).toHaveBeenCalledTimes(1)
    })
  })

  describe('clear', () => {
    it('should not clear if the close function does not match', () => {
      const closeFn = vi.fn()
      const otherCloseFn = vi.fn()

      manager.register(closeFn)
      manager.clear(otherCloseFn)

      manager.closeActiveTooltip()
      expect(closeFn).toHaveBeenCalledTimes(1)
    })

    it('should clear the close function if it matches', () => {
      const closeFn = vi.fn()

      manager.register(closeFn)
      manager.clear(closeFn)

      manager.closeActiveTooltip()
      expect(closeFn).not.toHaveBeenCalled()
    })

    it('should not call the close function when clearing', () => {
      const closeFn = vi.fn()

      manager.register(closeFn)
      manager.clear(closeFn)

      expect(closeFn).not.toHaveBeenCalled()
    })
  })

  describe('closeActiveTooltip', () => {
    it('should do nothing when no active closer is registered', () => {
      expect(() => manager.closeActiveTooltip()).not.toThrow()
    })

    it('should call the active closer function', () => {
      const closeFn = vi.fn()
      manager.register(closeFn)

      manager.closeActiveTooltip()

      expect(closeFn).toHaveBeenCalledTimes(1)
    })

    it('should clear the active closer after calling it', () => {
      const closeFn = vi.fn()
      manager.register(closeFn)

      manager.closeActiveTooltip()
      manager.closeActiveTooltip()

      expect(closeFn).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple register and close cycles', () => {
      const closeFn1 = vi.fn()
      const closeFn2 = vi.fn()
      const closeFn3 = vi.fn()

      manager.register(closeFn1)
      manager.closeActiveTooltip()

      manager.register(closeFn2)
      manager.closeActiveTooltip()

      manager.register(closeFn3)
      manager.closeActiveTooltip()

      expect(closeFn1).toHaveBeenCalledTimes(1)
      expect(closeFn2).toHaveBeenCalledTimes(1)
      expect(closeFn3).toHaveBeenCalledTimes(1)
    })
  })
})
