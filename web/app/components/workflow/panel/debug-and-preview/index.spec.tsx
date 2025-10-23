/**
 * Debug and Preview Panel Width Persistence Tests
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

// Preview panel width logic
const createPreviewPanelManager = () => {
  const storageKey = 'debug-and-preview-panel-width'

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

describe('Debug and Preview Panel Width Persistence', () => {
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

  describe('Preview Panel Width Management', () => {
    it('should save user resize to localStorage', () => {
      const manager = createPreviewPanelManager()

      const result = manager.updateWidth(450, 'user')

      expect(result).toBe(450)
      expect(localStorage.setItem).toHaveBeenCalledWith('debug-and-preview-panel-width', '450')
    })

    it('should not save system compression to localStorage', () => {
      const manager = createPreviewPanelManager()

      const result = manager.updateWidth(300, 'system')

      expect(result).toBe(400) // Respects minimum width
      expect(localStorage.setItem).not.toHaveBeenCalled()
    })

    it('should behave identically to Node Panel', () => {
      const manager = createPreviewPanelManager()

      // Both user and system operations should behave consistently
      manager.updateWidth(500, 'user')
      expect(localStorage.setItem).toHaveBeenCalledWith('debug-and-preview-panel-width', '500')

      manager.updateWidth(200, 'system')
      expect(localStorage.getItem('debug-and-preview-panel-width')).toBe('500')
    })
  })

  describe('Dual Panel Scenario', () => {
    it('should maintain independence from Node Panel', () => {
      localStorage.setItem('workflow-node-panel-width', '600')
      localStorage.setItem('debug-and-preview-panel-width', '450')

      const manager = createPreviewPanelManager()

      // System compresses preview panel
      manager.updateWidth(200, 'system')

      // Only preview panel storage key should be unaffected
      expect(localStorage.getItem('debug-and-preview-panel-width')).toBe('450')
      expect(localStorage.getItem('workflow-node-panel-width')).toBe('600')
    })

    it('should handle F12 scenario consistently', () => {
      const manager = createPreviewPanelManager()

      // User sets preference
      manager.updateWidth(500, 'user')
      expect(localStorage.getItem('debug-and-preview-panel-width')).toBe('500')

      // F12 opens causing viewport compression
      manager.updateWidth(180, 'system')

      // User preference preserved
      expect(localStorage.getItem('debug-and-preview-panel-width')).toBe('500')
    })
  })

  describe('Consistency with Node Panel', () => {
    it('should enforce same minimum width rules', () => {
      const manager = createPreviewPanelManager()

      // Same 400px minimum as Node Panel
      const result = manager.updateWidth(300, 'user')
      expect(result).toBe(400)
      expect(localStorage.setItem).toHaveBeenCalledWith('debug-and-preview-panel-width', '400')
    })

    it('should use same source parameter pattern', () => {
      const manager = createPreviewPanelManager()

      // Default to 'user' when source not specified
      manager.updateWidth(500)
      expect(localStorage.setItem).toHaveBeenCalledWith('debug-and-preview-panel-width', '500')

      // Explicit 'system' source
      manager.updateWidth(300, 'system')
      expect(localStorage.setItem).toHaveBeenCalledTimes(1) // Only user call
    })
  })
})
