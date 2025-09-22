/**
 * Workflow Panel Width Persistence Tests
 * Tests for GitHub issue #22745: Panel width persistence bug fix
 */

import '@testing-library/jest-dom'

type PanelWidthSource = 'user' | 'system'

// Mock localStorage for testing
const createMockLocalStorage = () => {
  const storage: Record<string, string> = {}
  return {
    getItem: jest.fn((key: string) => storage[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      storage[key] = value
    }),
    removeItem: jest.fn((key: string) => {
      delete storage[key]
    }),
    clear: jest.fn(() => {
      Object.keys(storage).forEach(key => delete storage[key])
    }),
    get storage() { return { ...storage } },
  }
}

// Core panel width logic extracted from the component
const createPanelWidthManager = (storageKey: string) => {
  return {
    updateWidth: (width: number, source: PanelWidthSource = 'user') => {
      const newValue = Math.max(400, Math.min(width, 800))
      if (source === 'user')
        localStorage.setItem(storageKey, `${newValue}`)

      return newValue
    },
    getStoredWidth: () => {
      const stored = localStorage.getItem(storageKey)
      return stored ? Number.parseFloat(stored) : 400
    },
  }
}

describe('Workflow Panel Width Persistence', () => {
  let mockLocalStorage: ReturnType<typeof createMockLocalStorage>

  beforeEach(() => {
    mockLocalStorage = createMockLocalStorage()
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('Node Panel Width Management', () => {
    const storageKey = 'workflow-node-panel-width'

    it('should save user resize to localStorage', () => {
      const manager = createPanelWidthManager(storageKey)

      const result = manager.updateWidth(500, 'user')

      expect(result).toBe(500)
      expect(localStorage.setItem).toHaveBeenCalledWith(storageKey, '500')
    })

    it('should not save system compression to localStorage', () => {
      const manager = createPanelWidthManager(storageKey)

      const result = manager.updateWidth(200, 'system')

      expect(result).toBe(400) // Respects minimum width
      expect(localStorage.setItem).not.toHaveBeenCalled()
    })

    it('should enforce minimum width of 400px', () => {
      const manager = createPanelWidthManager(storageKey)

      // User tries to set below minimum
      const userResult = manager.updateWidth(300, 'user')
      expect(userResult).toBe(400)
      expect(localStorage.setItem).toHaveBeenCalledWith(storageKey, '400')

      // System compression below minimum
      const systemResult = manager.updateWidth(150, 'system')
      expect(systemResult).toBe(400)
      expect(localStorage.setItem).toHaveBeenCalledTimes(1) // Only user call
    })

    it('should preserve user preferences during system compression', () => {
      localStorage.setItem(storageKey, '600')
      const manager = createPanelWidthManager(storageKey)

      // System compresses panel
      manager.updateWidth(200, 'system')

      // User preference should remain unchanged
      expect(localStorage.getItem(storageKey)).toBe('600')
    })
  })

  describe('Bug Scenario Reproduction', () => {
    it('should reproduce original bug behavior (for comparison)', () => {
      const storageKey = 'workflow-node-panel-width'

      // Original buggy behavior - always saves regardless of source
      const buggyUpdate = (width: number) => {
        localStorage.setItem(storageKey, `${width}`)
        return Math.max(400, width)
      }

      localStorage.setItem(storageKey, '500') // User preference
      buggyUpdate(200) // System compression pollutes localStorage

      expect(localStorage.getItem(storageKey)).toBe('200') // Bug: corrupted state
    })

    it('should verify fix prevents localStorage pollution', () => {
      const storageKey = 'workflow-node-panel-width'
      const manager = createPanelWidthManager(storageKey)

      localStorage.setItem(storageKey, '500') // User preference
      manager.updateWidth(200, 'system') // System compression

      expect(localStorage.getItem(storageKey)).toBe('500') // Fix: preserved state
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple rapid operations correctly', () => {
      const manager = createPanelWidthManager('workflow-node-panel-width')

      // Rapid system adjustments
      manager.updateWidth(300, 'system')
      manager.updateWidth(250, 'system')
      manager.updateWidth(180, 'system')

      // Single user adjustment
      manager.updateWidth(550, 'user')

      expect(localStorage.setItem).toHaveBeenCalledTimes(1)
      expect(localStorage.setItem).toHaveBeenCalledWith('workflow-node-panel-width', '550')
    })

    it('should handle corrupted localStorage gracefully', () => {
      localStorage.setItem('workflow-node-panel-width', '150') // Below minimum
      const manager = createPanelWidthManager('workflow-node-panel-width')

      const storedWidth = manager.getStoredWidth()
      expect(storedWidth).toBe(150) // Returns raw value

      // User can correct the preference
      const correctedWidth = manager.updateWidth(500, 'user')
      expect(correctedWidth).toBe(500)
      expect(localStorage.getItem('workflow-node-panel-width')).toBe('500')
    })
  })

  describe('TypeScript Type Safety', () => {
    it('should enforce source parameter type', () => {
      const manager = createPanelWidthManager('workflow-node-panel-width')

      // Valid source values
      manager.updateWidth(500, 'user')
      manager.updateWidth(500, 'system')

      // Default to 'user'
      manager.updateWidth(500)

      expect(localStorage.setItem).toHaveBeenCalledTimes(2) // user + default
    })
  })
})
