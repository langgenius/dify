import type { SlashCommandHandler } from '../types'
import { SlashCommandRegistry } from '../registry'

function createHandler(overrides: Partial<SlashCommandHandler> = {}): SlashCommandHandler {
  return {
    name: 'test',
    description: 'Test command',
    search: vi.fn().mockResolvedValue([]),
    register: vi.fn(),
    unregister: vi.fn(),
    ...overrides,
  }
}

describe('SlashCommandRegistry', () => {
  let registry: SlashCommandRegistry

  beforeEach(() => {
    registry = new SlashCommandRegistry()
  })

  describe('register & findCommand', () => {
    it('registers a handler and retrieves it by name', () => {
      const handler = createHandler({ name: 'docs' })
      registry.register(handler)

      expect(registry.findCommand('docs')).toBe(handler)
    })

    it('registers aliases so handler is found by any alias', () => {
      const handler = createHandler({ name: 'language', aliases: ['lang', 'l'] })
      registry.register(handler)

      expect(registry.findCommand('language')).toBe(handler)
      expect(registry.findCommand('lang')).toBe(handler)
      expect(registry.findCommand('l')).toBe(handler)
    })

    it('calls handler.register with provided deps', () => {
      const handler = createHandler({ name: 'theme' })
      const deps = { setTheme: vi.fn() }
      registry.register(handler, deps)

      expect(handler.register).toHaveBeenCalledWith(deps)
    })

    it('does not call handler.register when no deps provided', () => {
      const handler = createHandler({ name: 'docs' })
      registry.register(handler)

      expect(handler.register).not.toHaveBeenCalled()
    })

    it('returns undefined for unknown command name', () => {
      expect(registry.findCommand('nonexistent')).toBeUndefined()
    })
  })

  describe('unregister', () => {
    it('removes handler by name', () => {
      const handler = createHandler({ name: 'docs' })
      registry.register(handler)
      registry.unregister('docs')

      expect(registry.findCommand('docs')).toBeUndefined()
    })

    it('removes all aliases', () => {
      const handler = createHandler({ name: 'language', aliases: ['lang'] })
      registry.register(handler)
      registry.unregister('language')

      expect(registry.findCommand('language')).toBeUndefined()
      expect(registry.findCommand('lang')).toBeUndefined()
    })

    it('calls handler.unregister', () => {
      const handler = createHandler({ name: 'docs' })
      registry.register(handler)
      registry.unregister('docs')

      expect(handler.unregister).toHaveBeenCalled()
    })

    it('is a no-op for unknown command', () => {
      expect(() => registry.unregister('unknown')).not.toThrow()
    })
  })

  describe('getAllCommands', () => {
    it('returns deduplicated handlers', () => {
      const h1 = createHandler({ name: 'theme', aliases: ['t'] })
      const h2 = createHandler({ name: 'docs' })
      registry.register(h1)
      registry.register(h2)

      const commands = registry.getAllCommands()
      expect(commands).toHaveLength(2)
      expect(commands).toContainEqual(expect.objectContaining({ name: 'theme' }))
      expect(commands).toContainEqual(expect.objectContaining({ name: 'docs' }))
    })

    it('returns empty array when nothing registered', () => {
      expect(registry.getAllCommands()).toEqual([])
    })
  })

  describe('getAvailableCommands', () => {
    it('includes commands without isAvailable guard', () => {
      registry.register(createHandler({ name: 'docs' }))

      expect(registry.getAvailableCommands()).toHaveLength(1)
    })

    it('includes commands where isAvailable returns true', () => {
      registry.register(createHandler({ name: 'zen', isAvailable: () => true }))

      expect(registry.getAvailableCommands()).toHaveLength(1)
    })

    it('excludes commands where isAvailable returns false', () => {
      registry.register(createHandler({ name: 'zen', isAvailable: () => false }))

      expect(registry.getAvailableCommands()).toHaveLength(0)
    })
  })

  describe('search', () => {
    it('returns root commands for "/"', async () => {
      registry.register(createHandler({ name: 'theme', description: 'Change theme' }))
      registry.register(createHandler({ name: 'docs', description: 'Open docs' }))

      const results = await registry.search('/')

      expect(results).toHaveLength(2)
      expect(results[0]).toMatchObject({
        id: expect.stringContaining('root-'),
        type: 'command',
      })
    })

    it('returns root commands for "/ "', async () => {
      registry.register(createHandler({ name: 'theme' }))

      const results = await registry.search('/ ')
      expect(results).toHaveLength(1)
    })

    it('delegates to exact-match handler for "/theme dark"', async () => {
      const mockResults = [{ id: 'dark', title: 'Dark', description: '', type: 'command' as const, data: {} }]
      const handler = createHandler({
        name: 'theme',
        search: vi.fn().mockResolvedValue(mockResults),
      })
      registry.register(handler)

      const results = await registry.search('/theme dark')

      expect(handler.search).toHaveBeenCalledWith('dark', 'en')
      expect(results).toEqual(mockResults)
    })

    it('delegates to exact-match handler for command without args', async () => {
      const handler = createHandler({ name: 'docs', search: vi.fn().mockResolvedValue([]) })
      registry.register(handler)

      await registry.search('/docs')

      expect(handler.search).toHaveBeenCalledWith('', 'en')
    })

    it('uses partial match when no exact match found', async () => {
      const mockResults = [{ id: '1', title: 'T', description: '', type: 'command' as const, data: {} }]
      const handler = createHandler({
        name: 'theme',
        search: vi.fn().mockResolvedValue(mockResults),
      })
      registry.register(handler)

      const results = await registry.search('/the')

      expect(results).toEqual(mockResults)
    })

    it('uses alias partial match', async () => {
      const mockResults = [{ id: '1', title: 'L', description: '', type: 'command' as const, data: {} }]
      const handler = createHandler({
        name: 'language',
        aliases: ['lang'],
        search: vi.fn().mockResolvedValue(mockResults),
      })
      registry.register(handler)

      const results = await registry.search('/lan')

      expect(results).toEqual(mockResults)
    })

    it('falls back to fuzzy search when nothing matches', async () => {
      registry.register(createHandler({ name: 'theme', description: 'Set theme' }))

      const results = await registry.search('/hem')

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('/theme')
    })

    it('fuzzy search also matches aliases', async () => {
      registry.register(createHandler({ name: 'language', aliases: ['lang'], description: 'Set language' }))

      const handler = registry.findCommand('language')
      await registry.search('/lan')
      expect(handler?.search).toHaveBeenCalled()
    })

    it('returns empty when handler.search throws', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const handler = createHandler({
        name: 'broken',
        search: vi.fn().mockRejectedValue(new Error('fail')),
      })
      registry.register(handler)

      const results = await registry.search('/broken')
      expect(results).toEqual([])
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Command search failed'),
        expect.any(Error),
      )
      warnSpy.mockRestore()
    })

    it('excludes unavailable commands from root listing', async () => {
      registry.register(createHandler({ name: 'zen', isAvailable: () => false }))
      registry.register(createHandler({ name: 'docs' }))

      const results = await registry.search('/')
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('/docs')
    })

    it('skips unavailable handler in exact match', async () => {
      registry.register(createHandler({ name: 'zen', isAvailable: () => false }))

      const results = await registry.search('/zen')
      expect(results).toEqual([])
    })

    it('passes locale to handler search', async () => {
      const handler = createHandler({ name: 'theme', search: vi.fn().mockResolvedValue([]) })
      registry.register(handler)

      await registry.search('/theme light', 'zh')

      expect(handler.search).toHaveBeenCalledWith('light', 'zh')
    })
  })

  describe('getCommandDependencies', () => {
    it('returns stored deps', () => {
      const deps = { setTheme: vi.fn() }
      registry.register(createHandler({ name: 'theme' }), deps)

      expect(registry.getCommandDependencies('theme')).toBe(deps)
    })

    it('returns undefined when no deps stored', () => {
      registry.register(createHandler({ name: 'docs' }))

      expect(registry.getCommandDependencies('docs')).toBeUndefined()
    })
  })
})
