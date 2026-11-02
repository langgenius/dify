import type { ActionItem } from '../types'
import type { CommandContext } from './types'
import { slashCommandRegistry } from './catalog'

export function createSlashAction(context: CommandContext): ActionItem {
  return {
    key: '/',
    shortcut: '/',
    title: context.t(($) => $['gotoAnything.actions.slashTitle'], { ns: 'app' }),
    description: context.t(($) => $['gotoAnything.actions.slashDesc'], { ns: 'app' }),
    source: 'local',
    matches: (query) =>
      slashCommandRegistry
        .getAvailableCommands(context)
        .some(
          (command) =>
            command.mode !== 'direct' &&
            [command.name, ...(command.aliases ?? [])].some((name) =>
              query.startsWith(`/${name} `),
            ),
        ),
    action: (result) => {
      if (result.type === 'command')
        void slashCommandRegistry.execute(result.data.command, result.data.args ?? {}, context)
    },
    search: (query) => slashCommandRegistry.search(query, context),
  }
}
