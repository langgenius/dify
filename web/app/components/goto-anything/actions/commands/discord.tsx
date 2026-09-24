import type { SlashCommandHandler } from './types'
import { getI18n } from 'react-i18next'
import { registerCommands, unregisterCommands } from './command-bus'

type DiscordDeps = Record<string, never>

const DISCORD_URL = 'https://discord.gg/5AEfbxcd9k'

const openDiscord = (url = DISCORD_URL) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export const discordCommand: SlashCommandHandler<DiscordDeps> = {
  name: 'discord',
  description: 'Open Discord community',
  mode: 'direct',

  execute: () => openDiscord(),

  search(_args: string, locale: string = 'en') {
    const i18n = getI18n()
    return [
      {
        id: 'discord',
        title: 'Discord',
        description:
          i18n.t(($) => $['gotoAnything.actions.discordDesc'], { ns: 'app', lng: locale }) ||
          'Open Discord community',
        type: 'command' as const,
        icon: (
          <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
            <span aria-hidden className="i-ri-discord-line size-4 text-text-tertiary" />
          </div>
        ),
        data: { command: 'navigation.discord', args: { url: DISCORD_URL } },
      },
    ]
  },

  register(_deps: DiscordDeps) {
    registerCommands({
      'navigation.discord': async (args) => openDiscord(args?.url),
    })
  },

  unregister() {
    unregisterCommands(['navigation.discord'])
  },
}
