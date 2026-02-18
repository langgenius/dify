import { registerCommands, unregisterCommands } from '../command-bus'
import { languageCommand } from '../language'

vi.mock('../command-bus')

vi.mock('react-i18next', () => ({
  getI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/i18n-config/language', () => ({
  languages: [
    { value: 'en-US', name: 'English', supported: true },
    { value: 'zh-Hans', name: '简体中文', supported: true },
    { value: 'ja-JP', name: '日本語', supported: true },
    { value: 'unsupported', name: 'Unsupported', supported: false },
  ],
}))

describe('languageCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct metadata', () => {
    expect(languageCommand.name).toBe('language')
    expect(languageCommand.aliases).toEqual(['lang'])
    expect(languageCommand.mode).toBe('submenu')
    expect(languageCommand.execute).toBeUndefined()
  })

  describe('search', () => {
    it('returns all supported languages when query is empty', async () => {
      const results = await languageCommand.search('', 'en')

      expect(results).toHaveLength(3) // 3 supported languages
      expect(results.every(r => r.type === 'command')).toBe(true)
    })

    it('filters languages by name query', async () => {
      const results = await languageCommand.search('english', 'en')

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('lang-en-US')
    })

    it('filters languages by value query', async () => {
      const results = await languageCommand.search('zh', 'en')

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('lang-zh-Hans')
    })

    it('returns command data with i18n.set command', async () => {
      const results = await languageCommand.search('', 'en')

      results.forEach((r) => {
        expect(r.data.command).toBe('i18n.set')
        expect(r.data.args).toHaveProperty('locale')
      })
    })
  })

  describe('register / unregister', () => {
    it('registers i18n.set command', () => {
      languageCommand.register?.({ setLocale: vi.fn() })

      expect(registerCommands).toHaveBeenCalledWith({ 'i18n.set': expect.any(Function) })
    })

    it('unregisters i18n.set command', () => {
      languageCommand.unregister?.()

      expect(unregisterCommands).toHaveBeenCalledWith(['i18n.set'])
    })

    it('registered handler calls setLocale with correct locale', async () => {
      const setLocale = vi.fn().mockResolvedValue(undefined)
      vi.mocked(registerCommands).mockImplementation((map) => {
        map['i18n.set']?.({ locale: 'zh-Hans' })
      })

      languageCommand.register?.({ setLocale })

      expect(setLocale).toHaveBeenCalledWith('zh-Hans')
    })
  })
})
