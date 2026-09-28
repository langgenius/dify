/**
 * Tests for direct-mode commands that share similar patterns:
 * docs, account, discord, models
 *
 * Each command: opens a URL or navigates, has direct mode, and registers a navigation command.
 */
import { accountCommand } from '../account'
import { registerCommands, unregisterCommands } from '../command-bus'
import { discordCommand } from '../discord'
import { docsCommand } from '../docs'
import { modelsCommand, SYSTEM_MODELS_PATH } from '../models'

vi.mock('../command-bus')

const mockT = vi.fn((key: string) => key)
vi.mock('react-i18next', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    getI18n: () => ({
      t: withSelectorKey((key: string) => mockT(key)),
      language: 'en',
    }),
  }
})

describe('docsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    docsCommand.unregister?.()
  })

  it('has correct metadata', () => {
    expect(docsCommand.name).toBe('docs')
    expect(docsCommand.mode).toBe('direct')
    expect(docsCommand.execute).toBeDefined()
  })

  it('execute opens documentation in new tab', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    docsCommand.register?.({ getDocsHomeUrl: () => 'https://docs.dify.ai/en/home' })

    docsCommand.execute?.()

    expect(openSpy).toHaveBeenCalledWith(
      'https://docs.dify.ai/en/home',
      '_blank',
      'noopener,noreferrer',
    )
    openSpy.mockRestore()
  })

  it('execute uses the documentation URL registered by the provider', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    docsCommand.register?.({
      getDocsHomeUrl: () => 'https://enterprise-docs.dify.ai/en/',
    })

    docsCommand.execute?.()

    expect(openSpy).toHaveBeenCalledWith(
      'https://enterprise-docs.dify.ai/en/',
      '_blank',
      'noopener,noreferrer',
    )
    openSpy.mockRestore()
  })

  it('search returns a single doc result', async () => {
    const results = await docsCommand.search('', 'en')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 'doc',
      type: 'command',
      data: { command: 'navigation.doc', args: {} },
    })
  })

  it('search uses fallback description when i18n returns empty', async () => {
    mockT.mockImplementation((key: string) => (key.includes('docDesc') ? '' : key))

    const results = await docsCommand.search('', 'en')

    expect(results[0]!.description).toBe('Open help documentation')
    mockT.mockImplementation((key: string) => key)
  })

  it('registers navigation.doc command', () => {
    docsCommand.register?.({ getDocsHomeUrl: () => 'https://docs.dify.ai/en/home' })
    expect(registerCommands).toHaveBeenCalledWith({ 'navigation.doc': expect.any(Function) })
  })

  it('registered handler opens doc URL with correct locale', async () => {
    docsCommand.register?.({
      getDocsHomeUrl: () => 'https://enterprise-docs.dify.ai/en/',
    })
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const handlers = vi.mocked(registerCommands).mock.calls[0]![0]
    await handlers['navigation.doc']!()

    expect(openSpy).toHaveBeenCalledWith(
      'https://enterprise-docs.dify.ai/en/',
      '_blank',
      'noopener,noreferrer',
    )
    openSpy.mockRestore()
  })

  it('unregisters navigation.doc command', () => {
    docsCommand.unregister?.()
    expect(unregisterCommands).toHaveBeenCalledWith(['navigation.doc'])
  })
})

describe('accountCommand', () => {
  let originalHref: string

  beforeEach(() => {
    vi.clearAllMocks()
    originalHref = window.location.href
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: { href: originalHref }, writable: true })
  })

  it('has correct metadata', () => {
    expect(accountCommand.name).toBe('account')
    expect(accountCommand.mode).toBe('direct')
    expect(accountCommand.execute).toBeDefined()
  })

  it('execute navigates to /account', () => {
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })
    accountCommand.execute?.()
    expect(window.location.href).toBe('/account')
  })

  it('search returns account result', async () => {
    const results = await accountCommand.search('', 'en')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 'account',
      type: 'command',
      data: { command: 'navigation.account', args: {} },
    })
  })

  it('registers navigation.account command', () => {
    accountCommand.register?.({} as Record<string, never>)
    expect(registerCommands).toHaveBeenCalledWith({ 'navigation.account': expect.any(Function) })
  })

  it('unregisters navigation.account command', () => {
    accountCommand.unregister?.()
    expect(unregisterCommands).toHaveBeenCalledWith(['navigation.account'])
  })
})

describe('discordCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct metadata', () => {
    expect(discordCommand.name).toBe('discord')
    expect(discordCommand.mode).toBe('direct')
    expect(discordCommand.execute).toBeDefined()
  })

  it('execute opens Discord URL', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    discordCommand.execute?.()

    expect(openSpy).toHaveBeenCalledWith(
      'https://discord.gg/5AEfbxcd9k',
      '_blank',
      'noopener,noreferrer',
    )
    openSpy.mockRestore()
  })

  it('search returns Discord result', async () => {
    const results = await discordCommand.search('', 'en')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 'discord',
      type: 'command',
      data: { command: 'navigation.discord' },
    })
  })

  it('search uses fallback description when i18n returns empty', async () => {
    mockT.mockImplementation((key: string) => (key.includes('discordDesc') ? '' : key))

    const results = await discordCommand.search('', 'en')

    expect(results[0]!.description).toBe('Open Discord community')
    mockT.mockImplementation((key: string) => key)
  })

  it('registers navigation.discord command', () => {
    discordCommand.register?.({} as Record<string, never>)
    expect(registerCommands).toHaveBeenCalledWith({ 'navigation.discord': expect.any(Function) })
  })

  it('registered handler opens URL from args', async () => {
    discordCommand.register?.({} as Record<string, never>)
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const handlers = vi.mocked(registerCommands).mock.calls[0]![0]
    await handlers['navigation.discord']!({ url: 'https://custom-url.com' })

    expect(openSpy).toHaveBeenCalledWith('https://custom-url.com', '_blank', 'noopener,noreferrer')
    openSpy.mockRestore()
  })

  it('registered handler falls back to default URL when no args', async () => {
    discordCommand.register?.({} as Record<string, never>)
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const handlers = vi.mocked(registerCommands).mock.calls[0]![0]
    await handlers['navigation.discord']!()

    expect(openSpy).toHaveBeenCalledWith(
      'https://discord.gg/5AEfbxcd9k',
      '_blank',
      'noopener,noreferrer',
    )
    openSpy.mockRestore()
  })

  it('unregisters navigation.discord command', () => {
    discordCommand.unregister?.()
    expect(unregisterCommands).toHaveBeenCalledWith(['navigation.discord'])
  })
})

describe('modelsCommand', () => {
  let originalHref: string

  beforeEach(() => {
    vi.clearAllMocks()
    originalHref = window.location.href
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: { href: originalHref }, writable: true })
  })

  it('has direct command metadata', () => {
    expect(modelsCommand.name).toBe('models')
    expect(modelsCommand.mode).toBe('direct')
    expect(modelsCommand.execute).toBeDefined()
  })

  it('navigates to model provider with the system model dialog URL state', () => {
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })

    modelsCommand.execute?.()

    expect(window.location.href).toBe(SYSTEM_MODELS_PATH)
  })

  it('search returns the system models result', async () => {
    const results = await modelsCommand.search('', 'en')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 'models',
      type: 'command',
      data: { command: 'navigation.models' },
    })
  })

  it('registers a navigation command that opens the system model route', async () => {
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })
    modelsCommand.register?.({} as Record<string, never>)
    const handlers = vi.mocked(registerCommands).mock.calls[0]![0]

    await handlers['navigation.models']!()

    expect(window.location.href).toBe(SYSTEM_MODELS_PATH)
  })

  it('unregisters navigation.models command', () => {
    modelsCommand.unregister?.()
    expect(unregisterCommands).toHaveBeenCalledWith(['navigation.models'])
  })
})
