import type { SlashCommand } from '../types'
import { SlashCommandRegistry } from '../registry'
import { createCommandContext } from './context'

const context = createCommandContext()
const command = (overrides: Partial<SlashCommand> = {}): SlashCommand => ({
  name: 'test',
  description: 'Test',
  search: () => [],
  execute: vi.fn(),
  ...overrides,
})

describe('command lookup and execution', () => {
  it('resolves names and aliases without duplicating the command directory', () => {
    const language = command({ name: 'language', aliases: ['lang'] })
    const registry = new SlashCommandRegistry([language])
    expect(registry.findCommand('lang')).toBe(language)
    expect(registry.search('/', context).map((result) => result.title)).toEqual(['/language'])
  })

  it('rejects ambiguous command names and aliases', () => {
    expect(
      () =>
        new SlashCommandRegistry([
          command({ name: 'language', aliases: ['lang'] }),
          command({ name: 'lang' }),
        ]),
    ).toThrow('Duplicate slash command: lang')
  })

  it('forwards arguments through exact names, aliases, and partial names', () => {
    const search = vi.fn(() => [])
    const registry = new SlashCommandRegistry([
      command({ name: 'language', aliases: ['lang'], search }),
    ])
    for (const query of ['/language English', '/lang English', '/LANG English', '/lan English']) {
      registry.search(query, context)
      expect(search).toHaveBeenLastCalledWith('English', context)
    }
  })

  it('filters unavailable commands and rechecks availability before execution', async () => {
    const execute = vi.fn()
    const registry = new SlashCommandRegistry([
      command({
        name: 'refine',
        aliases: ['improve'],
        execute,
        isAvailable: (context) => context.currentApp !== null,
      }),
    ])
    const studio = createCommandContext({ currentApp: { id: 'app', mode: 'workflow' } })
    expect(registry.search('/', studio)).toHaveLength(1)
    expect(registry.search('/', context)).toEqual([])
    expect(registry.search('/improve', context)).toEqual([])
    await registry.execute('refine', {}, context)
    expect(execute).not.toHaveBeenCalled()
    await registry.execute('improve', {}, studio)
    expect(execute).toHaveBeenCalledWith({}, studio)
  })

  it.each(['throw', 'reject'] as const)(
    'reports an execution %s and keeps other commands usable',
    async (failure) => {
      const error = new Error('Command failed')
      const context = createCommandContext()
      const succeeding = vi.fn()
      const registry = new SlashCommandRegistry([
        command({
          execute: () => {
            if (failure === 'throw') throw error
            return Promise.reject(error)
          },
        }),
        command({ name: 'other', execute: succeeding }),
      ])
      await expect(registry.execute('test', {}, context)).resolves.toBeUndefined()
      expect(context.onError).toHaveBeenCalledExactlyOnceWith(error)
      await registry.execute('other', {}, context)
      expect(succeeding).toHaveBeenCalledExactlyOnceWith({}, context)
      expect(context.onError).toHaveBeenCalledTimes(1)
    },
  )

  it('contains command search failures and leaves other commands usable', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const registry = new SlashCommandRegistry([
      command({
        search: () => {
          throw new Error('Unavailable')
        },
      }),
      command({ name: 'other' }),
    ])
    expect(registry.search('/test', context)).toEqual([])
    expect(registry.search('/', context)).toHaveLength(2)
    warning.mockRestore()
  })
})
