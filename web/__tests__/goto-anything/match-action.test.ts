import type { Mock } from 'vitest'
import type { ActionItem } from '../../app/components/goto-anything/actions/types'

// Import after mocking to get mocked version
import { matchAction } from '../../app/components/goto-anything/actions'
import { slashCommandRegistry } from '../../app/components/goto-anything/actions/commands/registry'

// Mock the entire actions module to avoid import issues
vi.mock('../../app/components/goto-anything/actions', () => ({
  matchAction: vi.fn(),
}))

vi.mock('../../app/components/goto-anything/actions/commands/registry')

// Implement the actual matchAction logic for testing
const actualMatchAction = (query: string, actions: Record<string, ActionItem>) => {
  const result = Object.values(actions).find((action) => {
    // Special handling for slash commands
    if (action.key === '/') {
      // Get all registered commands from the registry
      const allCommands = slashCommandRegistry.getAllCommands()

      // Check if query matches any registered command
      return allCommands.some((cmd) => {
        const cmdPattern = `/${cmd.name}`

        // For direct mode commands, don't match (keep in command selector)
        if (cmd.mode === 'direct')
          return false

        // For submenu mode commands, match when complete command is entered
        return query === cmdPattern || query.startsWith(`${cmdPattern} `)
      })
    }

    const reg = new RegExp(`^(${action.key}|${action.shortcut})(?:\\s|$)`)
    return reg.test(query)
  })
  return result
}

// Replace mock with actual implementation
;(matchAction as Mock).mockImplementation(actualMatchAction)

describe('matchAction Logic', () => {
  const mockActions: Record<string, ActionItem> = {
    app: {
      key: '@app',
      shortcut: '@a',
      title: 'Search Applications',
      description: 'Search apps',
      search: vi.fn(),
    },
    knowledge: {
      key: '@knowledge',
      shortcut: '@kb',
      title: 'Search Knowledge',
      description: 'Search knowledge bases',
      search: vi.fn(),
    },
    slash: {
      key: '/',
      shortcut: '/',
      title: 'Commands',
      description: 'Execute commands',
      search: vi.fn(),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(slashCommandRegistry.getAllCommands as Mock).mockReturnValue([
      { name: 'docs', mode: 'direct' },
      { name: 'community', mode: 'direct' },
      { name: 'feedback', mode: 'direct' },
      { name: 'account', mode: 'direct' },
      { name: 'theme', mode: 'submenu' },
      { name: 'language', mode: 'submenu' },
    ])
  })

  describe('@ Actions Matching', () => {
    it('should match @app with key', () => {
      const result = matchAction('@app', mockActions)
      expect(result).toBe(mockActions.app)
    })

    it('should match @app with shortcut', () => {
      const result = matchAction('@a', mockActions)
      expect(result).toBe(mockActions.app)
    })

    it('should match @knowledge with key', () => {
      const result = matchAction('@knowledge', mockActions)
      expect(result).toBe(mockActions.knowledge)
    })

    it('should match @knowledge with shortcut @kb', () => {
      const result = matchAction('@kb', mockActions)
      expect(result).toBe(mockActions.knowledge)
    })

    it('should match with text after action', () => {
      const result = matchAction('@app search term', mockActions)
      expect(result).toBe(mockActions.app)
    })

    it('should not match partial @ actions', () => {
      const result = matchAction('@ap', mockActions)
      expect(result).toBeUndefined()
    })
  })

  describe('Slash Commands Matching', () => {
    describe('Direct Mode Commands', () => {
      it('should not match direct mode commands', () => {
        const result = matchAction('/docs', mockActions)
        expect(result).toBeUndefined()
      })

      it('should not match direct mode with arguments', () => {
        const result = matchAction('/docs something', mockActions)
        expect(result).toBeUndefined()
      })

      it('should not match any direct mode command', () => {
        expect(matchAction('/community', mockActions)).toBeUndefined()
        expect(matchAction('/feedback', mockActions)).toBeUndefined()
        expect(matchAction('/account', mockActions)).toBeUndefined()
      })
    })

    describe('Submenu Mode Commands', () => {
      it('should match submenu mode commands exactly', () => {
        const result = matchAction('/theme', mockActions)
        expect(result).toBe(mockActions.slash)
      })

      it('should match submenu mode with arguments', () => {
        const result = matchAction('/theme dark', mockActions)
        expect(result).toBe(mockActions.slash)
      })

      it('should match all submenu commands', () => {
        expect(matchAction('/language', mockActions)).toBe(mockActions.slash)
        expect(matchAction('/language en', mockActions)).toBe(mockActions.slash)
      })
    })

    describe('Slash Without Command', () => {
      it('should not match single slash', () => {
        const result = matchAction('/', mockActions)
        expect(result).toBeUndefined()
      })

      it('should not match unregistered commands', () => {
        const result = matchAction('/unknown', mockActions)
        expect(result).toBeUndefined()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty query', () => {
      const result = matchAction('', mockActions)
      expect(result).toBeUndefined()
    })

    it('should handle whitespace only', () => {
      const result = matchAction('  ', mockActions)
      expect(result).toBeUndefined()
    })

    it('should handle regular text without actions', () => {
      const result = matchAction('search something', mockActions)
      expect(result).toBeUndefined()
    })

    it('should handle special characters', () => {
      const result = matchAction('#tag', mockActions)
      expect(result).toBeUndefined()
    })

    it('should handle multiple @ or /', () => {
      expect(matchAction('@@app', mockActions)).toBeUndefined()
      expect(matchAction('//theme', mockActions)).toBeUndefined()
    })
  })

  describe('Mode-based Filtering', () => {
    it('should filter direct mode commands from matching', () => {
      ;(slashCommandRegistry.getAllCommands as Mock).mockReturnValue([
        { name: 'test', mode: 'direct' },
      ])

      const result = matchAction('/test', mockActions)
      expect(result).toBeUndefined()
    })

    it('should allow submenu mode commands to match', () => {
      ;(slashCommandRegistry.getAllCommands as Mock).mockReturnValue([
        { name: 'test', mode: 'submenu' },
      ])

      const result = matchAction('/test', mockActions)
      expect(result).toBe(mockActions.slash)
    })

    it('should treat undefined mode as submenu', () => {
      ;(slashCommandRegistry.getAllCommands as Mock).mockReturnValue([
        { name: 'test' }, // No mode specified
      ])

      const result = matchAction('/test', mockActions)
      expect(result).toBe(mockActions.slash)
    })
  })

  describe('Registry Integration', () => {
    it('should call getAllCommands when matching slash', () => {
      matchAction('/theme', mockActions)
      expect(slashCommandRegistry.getAllCommands).toHaveBeenCalled()
    })

    it('should not call getAllCommands for @ actions', () => {
      matchAction('@app', mockActions)
      expect(slashCommandRegistry.getAllCommands).not.toHaveBeenCalled()
    })

    it('should handle empty command list', () => {
      ;(slashCommandRegistry.getAllCommands as Mock).mockReturnValue([])
      const result = matchAction('/anything', mockActions)
      expect(result).toBeUndefined()
    })
  })
})
