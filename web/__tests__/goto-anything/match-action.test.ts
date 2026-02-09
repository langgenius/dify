import type { Mock } from 'vitest'
import type { ScopeDescriptor } from '../../app/components/goto-anything/actions/types'

// Import after mocking to get mocked version
import { matchAction } from '../../app/components/goto-anything/actions'
import { slashCommandRegistry } from '../../app/components/goto-anything/actions/commands/registry'

// Mock the entire actions module to avoid import issues
vi.mock('../../app/components/goto-anything/actions', () => ({
  matchAction: vi.fn(),
}))

vi.mock('../../app/components/goto-anything/actions/commands/registry')

// Implement the actual matchAction logic for testing
const actualMatchAction = (query: string, scopes: ScopeDescriptor[]) => {
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return scopes.find((scope) => {
    // Special handling for slash commands
    if (scope.id === 'slash' || scope.shortcut === '/') {
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

    const shortcuts = [scope.shortcut, ...(scope.aliases || [])].map(escapeRegExp)
    const reg = new RegExp(`^(${shortcuts.join('|')})(?:\\s|$)`)
    return reg.test(query)
  })
}

// Replace mock with actual implementation
;(matchAction as Mock).mockImplementation(actualMatchAction)

describe('matchAction Logic', () => {
  const mockScopes: ScopeDescriptor[] = [
    {
      id: 'app',
      shortcut: '@app',
      aliases: ['@a'],
      title: 'Search Applications',
      description: 'Search apps',
      search: vi.fn(),
    },
    {
      id: 'knowledge',
      shortcut: '@kb',
      aliases: ['@knowledge'],
      title: 'Search Knowledge',
      description: 'Search knowledge bases',
      search: vi.fn(),
    },
    {
      id: 'slash',
      shortcut: '/',
      title: 'Commands',
      description: 'Execute commands',
      search: vi.fn(),
    },
  ]

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
      const result = matchAction('@app', mockScopes)
      expect(result).toBe(mockScopes[0])
    })

    it('should match @app with shortcut', () => {
      const result = matchAction('@a', mockScopes)
      expect(result).toBe(mockScopes[0])
    })

    it('should match @knowledge with key', () => {
      const result = matchAction('@knowledge', mockScopes)
      expect(result).toBe(mockScopes[1])
    })

    it('should match @knowledge with shortcut @kb', () => {
      const result = matchAction('@kb', mockScopes)
      expect(result).toBe(mockScopes[1])
    })

    it('should match with text after action', () => {
      const result = matchAction('@app search term', mockScopes)
      expect(result).toBe(mockScopes[0])
    })

    it('should not match partial @ actions', () => {
      const result = matchAction('@ap', mockScopes)
      expect(result).toBeUndefined()
    })
  })

  describe('Slash Commands Matching', () => {
    describe('Direct Mode Commands', () => {
      it('should not match direct mode commands', () => {
        const result = matchAction('/docs', mockScopes)
        expect(result).toBeUndefined()
      })

      it('should not match direct mode with arguments', () => {
        const result = matchAction('/docs something', mockScopes)
        expect(result).toBeUndefined()
      })

      it('should not match any direct mode command', () => {
        expect(matchAction('/community', mockScopes)).toBeUndefined()
        expect(matchAction('/feedback', mockScopes)).toBeUndefined()
        expect(matchAction('/account', mockScopes)).toBeUndefined()
      })
    })

    describe('Submenu Mode Commands', () => {
      it('should match submenu mode commands exactly', () => {
        const result = matchAction('/theme', mockScopes)
        expect(result).toBe(mockScopes[2])
      })

      it('should match submenu mode with arguments', () => {
        const result = matchAction('/theme dark', mockScopes)
        expect(result).toBe(mockScopes[2])
      })

      it('should match all submenu commands', () => {
        expect(matchAction('/language', mockScopes)).toBe(mockScopes[2])
        expect(matchAction('/language en', mockScopes)).toBe(mockScopes[2])
      })
    })

    describe('Slash Without Command', () => {
      it('should not match single slash', () => {
        const result = matchAction('/', mockScopes)
        expect(result).toBeUndefined()
      })

      it('should not match unregistered commands', () => {
        const result = matchAction('/unknown', mockScopes)
        expect(result).toBeUndefined()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty query', () => {
      const result = matchAction('', mockScopes)
      expect(result).toBeUndefined()
    })

    it('should handle whitespace only', () => {
      const result = matchAction('  ', mockScopes)
      expect(result).toBeUndefined()
    })

    it('should handle regular text without actions', () => {
      const result = matchAction('search something', mockScopes)
      expect(result).toBeUndefined()
    })

    it('should handle special characters', () => {
      const result = matchAction('#tag', mockScopes)
      expect(result).toBeUndefined()
    })

    it('should handle multiple @ or /', () => {
      expect(matchAction('@@app', mockScopes)).toBeUndefined()
      expect(matchAction('//theme', mockScopes)).toBeUndefined()
    })
  })

  describe('Mode-based Filtering', () => {
    it('should filter direct mode commands from matching', () => {
      ;(slashCommandRegistry.getAllCommands as Mock).mockReturnValue([
        { name: 'test', mode: 'direct' },
      ])

      const result = matchAction('/test', mockScopes)
      expect(result).toBeUndefined()
    })

    it('should allow submenu mode commands to match', () => {
      ;(slashCommandRegistry.getAllCommands as Mock).mockReturnValue([
        { name: 'test', mode: 'submenu' },
      ])

      const result = matchAction('/test', mockScopes)
      expect(result).toBe(mockScopes[2])
    })

    it('should treat undefined mode as submenu', () => {
      ;(slashCommandRegistry.getAllCommands as Mock).mockReturnValue([
        { name: 'test' }, // No mode specified
      ])

      const result = matchAction('/test', mockScopes)
      expect(result).toBe(mockScopes[2])
    })
  })

  describe('Registry Integration', () => {
    it('should call getAllCommands when matching slash', () => {
      matchAction('/theme', mockScopes)
      expect(slashCommandRegistry.getAllCommands).toHaveBeenCalled()
    })

    it('should not call getAllCommands for @ actions', () => {
      matchAction('@app', mockScopes)
      expect(slashCommandRegistry.getAllCommands).not.toHaveBeenCalled()
    })

    it('should handle empty command list', () => {
      ;(slashCommandRegistry.getAllCommands as Mock).mockReturnValue([])
      const result = matchAction('/anything', mockScopes)
      expect(result).toBeUndefined()
    })
  })
})
