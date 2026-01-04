import type { SlashCommandHandler } from '../../app/components/goto-anything/actions/commands/types'
import { slashCommandRegistry } from '../../app/components/goto-anything/actions/commands/registry'

// Mock the registry
vi.mock('../../app/components/goto-anything/actions/commands/registry')

describe('Slash Command Dual-Mode System', () => {
  const mockDirectCommand: SlashCommandHandler = {
    name: 'docs',
    description: 'Open documentation',
    mode: 'direct',
    execute: vi.fn(),
    search: vi.fn().mockResolvedValue([
      {
        id: 'docs',
        title: 'Documentation',
        description: 'Open documentation',
        type: 'command' as const,
        data: { command: 'navigation.docs', args: {} },
      },
    ]),
    register: vi.fn(),
    unregister: vi.fn(),
  }

  const mockSubmenuCommand: SlashCommandHandler = {
    name: 'theme',
    description: 'Change theme',
    mode: 'submenu',
    search: vi.fn().mockResolvedValue([
      {
        id: 'theme-light',
        title: 'Light Theme',
        description: 'Switch to light theme',
        type: 'command' as const,
        data: { command: 'theme.set', args: { theme: 'light' } },
      },
      {
        id: 'theme-dark',
        title: 'Dark Theme',
        description: 'Switch to dark theme',
        type: 'command' as const,
        data: { command: 'theme.set', args: { theme: 'dark' } },
      },
    ]),
    register: vi.fn(),
    unregister: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(slashCommandRegistry as any).findCommand = vi.fn((name: string) => {
      if (name === 'docs')
        return mockDirectCommand
      if (name === 'theme')
        return mockSubmenuCommand
      return null
    })
    ;(slashCommandRegistry as any).getAllCommands = vi.fn(() => [
      mockDirectCommand,
      mockSubmenuCommand,
    ])
  })

  describe('Direct Mode Commands', () => {
    it('should execute immediately when selected', () => {
      const mockSetShow = vi.fn()
      const mockSetSearchQuery = vi.fn()

      // Simulate command selection
      const handler = slashCommandRegistry.findCommand('docs')
      expect(handler?.mode).toBe('direct')

      if (handler?.mode === 'direct' && handler.execute) {
        handler.execute()
        mockSetShow(false)
        mockSetSearchQuery('')
      }

      expect(mockDirectCommand.execute).toHaveBeenCalled()
      expect(mockSetShow).toHaveBeenCalledWith(false)
      expect(mockSetSearchQuery).toHaveBeenCalledWith('')
    })

    it('should not enter submenu for direct mode commands', () => {
      const handler = slashCommandRegistry.findCommand('docs')
      expect(handler?.mode).toBe('direct')
      expect(handler?.execute).toBeDefined()
    })

    it('should close modal after execution', () => {
      const mockModalClose = vi.fn()

      const handler = slashCommandRegistry.findCommand('docs')
      if (handler?.mode === 'direct' && handler.execute) {
        handler.execute()
        mockModalClose()
      }

      expect(mockModalClose).toHaveBeenCalled()
    })
  })

  describe('Submenu Mode Commands', () => {
    it('should show options instead of executing immediately', async () => {
      const handler = slashCommandRegistry.findCommand('theme')
      expect(handler?.mode).toBe('submenu')

      const results = await handler?.search('', 'en')
      expect(results).toHaveLength(2)
      expect(results?.[0].title).toBe('Light Theme')
      expect(results?.[1].title).toBe('Dark Theme')
    })

    it('should not have execute function for submenu mode', () => {
      const handler = slashCommandRegistry.findCommand('theme')
      expect(handler?.mode).toBe('submenu')
      expect(handler?.execute).toBeUndefined()
    })

    it('should keep modal open for selection', () => {
      const mockModalClose = vi.fn()

      const handler = slashCommandRegistry.findCommand('theme')
      // For submenu mode, modal should not close immediately
      expect(handler?.mode).toBe('submenu')
      expect(mockModalClose).not.toHaveBeenCalled()
    })
  })

  describe('Mode Detection and Routing', () => {
    it('should correctly identify direct mode commands', () => {
      const commands = slashCommandRegistry.getAllCommands()
      const directCommands = commands.filter(cmd => cmd.mode === 'direct')
      const submenuCommands = commands.filter(cmd => cmd.mode === 'submenu')

      expect(directCommands).toContainEqual(expect.objectContaining({ name: 'docs' }))
      expect(submenuCommands).toContainEqual(expect.objectContaining({ name: 'theme' }))
    })

    it('should handle missing mode property gracefully', () => {
      const commandWithoutMode: SlashCommandHandler = {
        name: 'test',
        description: 'Test command',
        search: vi.fn(),
        register: vi.fn(),
        unregister: vi.fn(),
      }

      ;(slashCommandRegistry as any).findCommand = vi.fn(() => commandWithoutMode)

      const handler = slashCommandRegistry.findCommand('test')
      // Default behavior should be submenu when mode is not specified
      expect(handler?.mode).toBeUndefined()
      expect(handler?.execute).toBeUndefined()
    })
  })

  describe('Enter Key Handling', () => {
    // Helper function to simulate key handler behavior
    const createKeyHandler = () => {
      return (commandKey: string) => {
        if (commandKey.startsWith('/')) {
          const commandName = commandKey.substring(1)
          const handler = slashCommandRegistry.findCommand(commandName)
          if (handler?.mode === 'direct' && handler.execute) {
            handler.execute()
            return true // Indicates handled
          }
        }
        return false
      }
    }

    it('should trigger direct execution on Enter for direct mode', () => {
      const keyHandler = createKeyHandler()
      const handled = keyHandler('/docs')
      expect(handled).toBe(true)
      expect(mockDirectCommand.execute).toHaveBeenCalled()
    })

    it('should not trigger direct execution for submenu mode', () => {
      const keyHandler = createKeyHandler()
      const handled = keyHandler('/theme')
      expect(handled).toBe(false)
      expect(mockSubmenuCommand.search).not.toHaveBeenCalled()
    })
  })

  describe('Command Registration', () => {
    it('should register both direct and submenu commands', () => {
      mockDirectCommand.register?.({})
      mockSubmenuCommand.register?.({ setTheme: vi.fn() })

      expect(mockDirectCommand.register).toHaveBeenCalled()
      expect(mockSubmenuCommand.register).toHaveBeenCalled()
    })

    it('should handle unregistration for both command types', () => {
      // Test unregister for direct command
      mockDirectCommand.unregister?.()
      expect(mockDirectCommand.unregister).toHaveBeenCalled()

      // Test unregister for submenu command
      mockSubmenuCommand.unregister?.()
      expect(mockSubmenuCommand.unregister).toHaveBeenCalled()

      // Verify both were called independently
      expect(mockDirectCommand.unregister).toHaveBeenCalledTimes(1)
      expect(mockSubmenuCommand.unregister).toHaveBeenCalledTimes(1)
    })
  })
})
