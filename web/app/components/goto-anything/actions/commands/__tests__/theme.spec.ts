import { registerCommands, unregisterCommands } from '../command-bus'
import { themeCommand } from '../theme'

vi.mock('../command-bus')

vi.mock('react-i18next', () => ({
  getI18n: () => ({
    t: (key: string) => key,
  }),
}))

describe('themeCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct metadata', () => {
    expect(themeCommand.name).toBe('theme')
    expect(themeCommand.mode).toBe('submenu')
    expect(themeCommand.execute).toBeUndefined()
  })

  describe('search', () => {
    it('returns all theme options when query is empty', async () => {
      const results = await themeCommand.search('', 'en')

      expect(results).toHaveLength(3)
      expect(results.map(r => r.id)).toEqual(['system', 'light', 'dark'])
    })

    it('returns all theme options with correct type', async () => {
      const results = await themeCommand.search('', 'en')

      results.forEach((r) => {
        expect(r.type).toBe('command')
        expect(r.data).toEqual({ command: 'theme.set', args: expect.objectContaining({ value: expect.any(String) }) })
      })
    })

    it('filters results by query matching id', async () => {
      const results = await themeCommand.search('dark', 'en')

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('dark')
    })
  })

  describe('register / unregister', () => {
    it('registers theme.set command with deps', () => {
      const deps = { setTheme: vi.fn() }
      themeCommand.register?.(deps)

      expect(registerCommands).toHaveBeenCalledWith({ 'theme.set': expect.any(Function) })
    })

    it('unregisters theme.set command', () => {
      themeCommand.unregister?.()

      expect(unregisterCommands).toHaveBeenCalledWith(['theme.set'])
    })

    it('registered handler calls setTheme', async () => {
      const setTheme = vi.fn()
      vi.mocked(registerCommands).mockImplementation((map) => {
        map['theme.set']?.({ value: 'dark' })
      })

      themeCommand.register?.({ setTheme })

      expect(setTheme).toHaveBeenCalledWith('dark')
    })
  })
})
