/**
 * Tests for direct-mode commands that share similar patterns:
 * docs, account, community, forum
 *
 * Each command: opens a URL or navigates, has direct mode, and registers a navigation command.
 */
import { accountCommand } from '../account'
import { registerCommands, unregisterCommands } from '../command-bus'
import { communityCommand } from '../community'
import { docsCommand } from '../docs'
import { forumCommand } from '../forum'

vi.mock('../command-bus')

vi.mock('react-i18next', () => ({
  getI18n: () => ({
    t: (key: string) => key,
    language: 'en',
  }),
}))

vi.mock('@/context/i18n', () => ({
  defaultDocBaseUrl: 'https://docs.dify.ai',
}))

vi.mock('@/i18n-config/language', () => ({
  getDocLanguage: (locale: string) => locale === 'en' ? 'en' : locale,
}))

describe('docsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct metadata', () => {
    expect(docsCommand.name).toBe('docs')
    expect(docsCommand.mode).toBe('direct')
    expect(docsCommand.execute).toBeDefined()
  })

  it('execute opens documentation in new tab', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    docsCommand.execute?.()

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://docs.dify.ai'),
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

  it('registers navigation.doc command', () => {
    docsCommand.register?.({} as Record<string, never>)
    expect(registerCommands).toHaveBeenCalledWith({ 'navigation.doc': expect.any(Function) })
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

describe('communityCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct metadata', () => {
    expect(communityCommand.name).toBe('community')
    expect(communityCommand.mode).toBe('direct')
    expect(communityCommand.execute).toBeDefined()
  })

  it('execute opens Discord URL', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    communityCommand.execute?.()

    expect(openSpy).toHaveBeenCalledWith(
      'https://discord.gg/5AEfbxcd9k',
      '_blank',
      'noopener,noreferrer',
    )
    openSpy.mockRestore()
  })

  it('search returns community result', async () => {
    const results = await communityCommand.search('', 'en')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 'community',
      type: 'command',
      data: { command: 'navigation.community' },
    })
  })

  it('registers navigation.community command', () => {
    communityCommand.register?.({} as Record<string, never>)
    expect(registerCommands).toHaveBeenCalledWith({ 'navigation.community': expect.any(Function) })
  })

  it('unregisters navigation.community command', () => {
    communityCommand.unregister?.()
    expect(unregisterCommands).toHaveBeenCalledWith(['navigation.community'])
  })
})

describe('forumCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct metadata', () => {
    expect(forumCommand.name).toBe('forum')
    expect(forumCommand.mode).toBe('direct')
    expect(forumCommand.execute).toBeDefined()
  })

  it('execute opens forum URL', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    forumCommand.execute?.()

    expect(openSpy).toHaveBeenCalledWith(
      'https://forum.dify.ai',
      '_blank',
      'noopener,noreferrer',
    )
    openSpy.mockRestore()
  })

  it('search returns forum result', async () => {
    const results = await forumCommand.search('', 'en')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 'forum',
      type: 'command',
      data: { command: 'navigation.forum' },
    })
  })

  it('registers navigation.forum command', () => {
    forumCommand.register?.({} as Record<string, never>)
    expect(registerCommands).toHaveBeenCalledWith({ 'navigation.forum': expect.any(Function) })
  })

  it('unregisters navigation.forum command', () => {
    forumCommand.unregister?.()
    expect(unregisterCommands).toHaveBeenCalledWith(['navigation.forum'])
  })
})
