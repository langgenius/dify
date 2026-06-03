import type { SearchResult } from '../../types'
import { render } from '@testing-library/react'
import { slashAction, SlashCommandProvider } from '../slash'

const {
  mockSetTheme,
  mockSetLocale,
  mockExecuteCommand,
  mockRegister,
  mockSearch,
  mockUnregister,
} = vi.hoisted(() => ({
  mockSetTheme: vi.fn(),
  mockSetLocale: vi.fn(),
  mockExecuteCommand: vi.fn(),
  mockRegister: vi.fn(),
  mockSearch: vi.fn(),
  mockUnregister: vi.fn(),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({
    setTheme: mockSetTheme,
  }),
}))

vi.mock('react-i18next', () => ({
  getI18n: () => ({
    language: 'ja',
    t: (key: string) => key,
  }),
}))

vi.mock('@/i18n-config', () => ({
  setLocaleOnClient: mockSetLocale,
}))

vi.mock('../command-bus', () => ({
  executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
}))

vi.mock('../registry', () => ({
  slashCommandRegistry: {
    register: (...args: unknown[]) => mockRegister(...args),
    search: (...args: unknown[]) => mockSearch(...args),
    unregister: (...args: unknown[]) => mockUnregister(...args),
  },
}))

describe('slashAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should expose translated title and description', () => {
    expect(slashAction.title).toBe('gotoAnything.actions.slashTitle')
    expect(slashAction.description).toBe('gotoAnything.actions.slashDesc')
  })

  it('should execute command results and ignore non-command results', () => {
    slashAction.action?.({
      id: 'cmd-1',
      title: 'Command',
      type: 'command',
      data: {
        command: 'navigation.docs',
        args: { path: '/docs' },
      },
    } as SearchResult)

    slashAction.action?.({
      id: 'app-1',
      title: 'App',
      type: 'app',
      data: {} as never,
    } as SearchResult)

    expect(mockExecuteCommand).toHaveBeenCalledTimes(1)
    expect(mockExecuteCommand).toHaveBeenCalledWith('navigation.docs', { path: '/docs' })
  })

  it('should delegate search to the slash command registry with the active language', async () => {
    mockSearch.mockResolvedValue([{ id: 'theme', title: '/theme', type: 'command', data: { command: 'theme' } }])

    const results = await slashAction.search('/theme dark', 'dark')

    expect(mockSearch).toHaveBeenCalledWith('/theme dark', 'ja')
    expect(results).toEqual([{ id: 'theme', title: '/theme', type: 'command', data: { command: 'theme' } }])
  })
})

describe('SlashCommandProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should register commands on mount and unregister them on unmount', () => {
    const { unmount } = render(<SlashCommandProvider />)

    expect(mockRegister.mock.calls.map(call => call[0].name)).toEqual([
      'theme',
      'language',
      'forum',
      'docs',
      'community',
      'account',
      'zen',
      'go',
    ])
    expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({ name: 'theme' }), { setTheme: mockSetTheme })
    expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({ name: 'language' }), { setLocale: mockSetLocale })

    unmount()

    expect(mockUnregister.mock.calls.map(call => call[0])).toEqual([
      'theme',
      'language',
      'forum',
      'docs',
      'community',
      'account',
      'zen',
      'go',
    ])
  })
})
