import { registerCommands, unregisterCommands } from '../command-bus'
import { goCommand } from '../go'

vi.mock('../command-bus')

describe('goCommand', () => {
  let originalHref: string

  beforeEach(() => {
    vi.clearAllMocks()
    originalHref = window.location.href
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: { href: originalHref }, writable: true })
  })

  it('has correct metadata', () => {
    expect(goCommand.name).toBe('go')
    expect(goCommand.mode).toBe('submenu')
    expect(goCommand.aliases).toEqual(['navigate', 'nav'])
    expect(goCommand.execute).toBeUndefined()
  })

  describe('search', () => {
    it('returns all navigation items when query is empty', async () => {
      const results = await goCommand.search('', 'en')

      expect(results.map(r => r.id)).toEqual([
        'go-apps',
        'go-datasets',
        'go-plugins',
        'go-tools',
        'go-explore',
        'go-account',
      ])
    })

    it('filters by id match', async () => {
      const results = await goCommand.search('plugins', 'en')

      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe('go-plugins')
    })

    it('filters by label match (case-insensitive)', async () => {
      const results = await goCommand.search('Knowledge', 'en')

      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe('go-datasets')
      expect(results[0]!.title).toBe('Knowledge')
    })

    it('returns command results with navigation.go data', async () => {
      const results = await goCommand.search('apps', 'en')

      expect(results[0]).toMatchObject({
        type: 'command',
        title: 'Apps',
        description: '/apps',
        data: { command: 'navigation.go', args: { path: '/apps' } },
      })
    })

    it('returns an empty list when nothing matches', async () => {
      const results = await goCommand.search('no-such-section', 'en')

      expect(results).toEqual([])
    })
  })

  describe('register / unregister', () => {
    it('registers navigation.go command', () => {
      goCommand.register?.({} as Record<string, never>)

      expect(registerCommands).toHaveBeenCalledWith({ 'navigation.go': expect.any(Function) })
    })

    it('unregisters navigation.go command', () => {
      goCommand.unregister?.()

      expect(unregisterCommands).toHaveBeenCalledWith(['navigation.go'])
    })

    it('registered handler navigates to the provided path', async () => {
      Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })
      goCommand.register?.({} as Record<string, never>)
      const handlers = vi.mocked(registerCommands).mock.calls[0]![0]

      await handlers['navigation.go']!({ path: '/datasets' })

      expect(window.location.href).toBe('/datasets')
    })

    it('registered handler does nothing when path is missing', async () => {
      Object.defineProperty(window, 'location', { value: { href: '/current' }, writable: true })
      goCommand.register?.({} as Record<string, never>)
      const handlers = vi.mocked(registerCommands).mock.calls[0]![0]

      await handlers['navigation.go']!()
      await handlers['navigation.go']!({})

      expect(window.location.href).toBe('/current')
    })
  })
})
