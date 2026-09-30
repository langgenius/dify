import type { SlashCommand } from './types'

const DISCORD_URL = 'https://discord.gg/5AEfbxcd9k'

export const discordCommand: SlashCommand = {
  name: 'discord',
  description: 'Open Discord community',
  mode: 'direct',

  execute: (_args, context) => context.openExternal(DISCORD_URL),

  search(args: string, context) {
    return [
      {
        id: 'discord',
        title: 'Discord',
        description:
          context.t(($) => $['gotoAnything.actions.discordDesc'], {
            ns: 'app',
            lng: context.locale,
          }) || 'Open Discord community',
        type: 'command' as const,
        icon: (
          <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
            <span aria-hidden className="i-ri-discord-line size-4 text-text-tertiary" />
          </div>
        ),
        data: { command: 'discord', args: { url: DISCORD_URL } },
      },
    ]
  },
}
