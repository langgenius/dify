import type { CommandContext } from '../types'
import { createInstance } from 'i18next'
import { renderToString } from 'react-dom/server'
import { accountCommand } from '../account'
import { slashCommandRegistry } from '../catalog'
import { discordCommand } from '../discord'
import { docsCommand } from '../docs'
import { goCommand } from '../go'
import { languageCommand } from '../language'
import { modelsCommand, SYSTEM_MODELS_PATH } from '../models'
import { refineCommand } from '../refine'
import { SlashCommandRegistry } from '../registry'
import { createSlashAction } from '../slash'
import { themeCommand } from '../theme'
import { createCommandContext } from './context'

const executeResult = (query: string, context: CommandContext) => {
  const action = createSlashAction(context)
  const result = slashCommandRegistry.search(query, context)[0]!
  action.action?.(result)
}

describe('command journeys', () => {
  it('lists and filters themes, and activates the selected theme', () => {
    const context = createCommandContext()
    expect(slashCommandRegistry.search('/theme', context).map((result) => result.id)).toEqual([
      'system',
      'light',
      'dark',
    ])
    executeResult('/theme dark', context)
    expect(context.setTheme).toHaveBeenCalledExactlyOnceWith('dark')
  })

  it('finds a language by its native name and activates it through the alias', async () => {
    const context = createCommandContext()
    const result = slashCommandRegistry.search('/lang 简体中文', context)[0]!
    expect(result.title).toBe('简体中文')
    await slashCommandRegistry.execute(result.data.command, result.data.args ?? {}, context)
    expect(context.setLocale).toHaveBeenCalledExactlyOnceWith('zh-Hans')
  })

  it('uses the current destination for direct and search-result activation', async () => {
    for (const command of [accountCommand, modelsCommand, docsCommand, discordCommand]) {
      const context = createCommandContext({
        getDocsHomeUrl: () => 'https://enterprise.example/help/zh',
      })
      const registry = new SlashCommandRegistry([command])
      await registry.execute(command.name, {}, context)
      const result = registry.search(`/${command.name}`, context)[0]!
      await registry.execute(result.data.command, result.data.args ?? {}, context)
      const callback =
        command === accountCommand || command === modelsCommand
          ? context.navigate
          : context.openExternal
      const destination =
        command === accountCommand
          ? '/account'
          : command === modelsCommand
            ? SYSTEM_MODELS_PATH
            : command === docsCommand
              ? 'https://enterprise.example/help/zh'
              : 'https://discord.gg/5AEfbxcd9k'
      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback).toHaveBeenLastCalledWith(destination)
    }
  })

  it('hides unavailable destinations and blocks a result selected before access changed', async () => {
    const context = createCommandContext()
    const agents = goCommand.search('agents', context)[0]!
    const restricted = createCommandContext({ agentsAvailable: false, skillsAvailable: false })
    expect(goCommand.search('', restricted).map((result) => result.id)).not.toContain('go-agents')
    expect(goCommand.search('skills', restricted)).toEqual([])
    await goCommand.execute(agents.data.args ?? {}, restricted)
    expect(restricted.navigate).not.toHaveBeenCalled()
    await goCommand.execute(agents.data.args ?? {}, context)
    expect(context.navigate).toHaveBeenCalledWith('/agents')
  })

  it.each(['workflow', 'advanced-chat'] as const)(
    'refines only the current %s app',
    async (mode) => {
      const context = createCommandContext({ currentApp: { id: 'current-app', mode } })
      const registry = new SlashCommandRegistry([refineCommand])
      await registry.execute('refine', {}, context)
      expect(context.openGenerator).toHaveBeenCalledWith({
        intent: 'refine',
        mode,
        currentAppId: 'current-app',
        currentAppMode: mode,
      })
      const outsideStudio = createCommandContext()
      await registry.execute('refine', {}, outsideStudio)
      expect(outsideStudio.openGenerator).not.toHaveBeenCalled()
    },
  )

  it('keeps language, permissions, docs links, and callbacks isolated between contexts', async () => {
    const first = createCommandContext({
      agentsAvailable: false,
      getDocsHomeUrl: () => 'https://one.example/docs',
    })
    const second = createCommandContext({ getDocsHomeUrl: () => 'https://two.example/docs' })
    expect(goCommand.search('agents', first)).toEqual([])
    expect(goCommand.search('agents', second)).toHaveLength(1)
    await docsCommand.execute({}, first)
    await docsCommand.execute({}, second)
    executeResult('/theme dark', second)
    expect(first.openExternal).toHaveBeenCalledExactlyOnceWith('https://one.example/docs')
    expect(second.openExternal).toHaveBeenCalledExactlyOnceWith('https://two.example/docs')
    expect(first.setTheme).not.toHaveBeenCalled()
    expect(second.setTheme).toHaveBeenCalledExactlyOnceWith('dark')
  })

  it('renders localized commands on the server without a browser or activation effects', async () => {
    const i18n = createInstance()
    await i18n.init({
      lng: 'en-US',
      resources: {
        'en-US': { app: { 'gotoAnything.actions.themeDark': 'Dark' } },
        'zh-Hans': { app: { 'gotoAnything.actions.themeDark': '深色' } },
      },
    })
    const first = createCommandContext({ t: i18n.t as CommandContext['t'] })
    const second = createCommandContext({ t: i18n.t as CommandContext['t'], locale: 'zh-Hans' })
    vi.stubGlobal('window', undefined)
    try {
      const renderCommands = (context: CommandContext) =>
        renderToString(
          <ul>
            {themeCommand.search('dark', context).map((result) => (
              <li key={result.id}>
                {result.title}
                {result.icon}
              </li>
            ))}
          </ul>,
        )
      expect(renderCommands(first)).toContain('Dark')
      expect(renderCommands(second)).toContain('深色')
      expect(renderCommands(first)).toContain('Dark')
      for (const context of [first, second]) {
        slashCommandRegistry.search('/', context)
        languageCommand.search('', context)
        expect(context.setTheme).not.toHaveBeenCalled()
        expect(context.openExternal).not.toHaveBeenCalled()
        expect(context.navigate).not.toHaveBeenCalled()
        expect(context.openGenerator).not.toHaveBeenCalled()
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
