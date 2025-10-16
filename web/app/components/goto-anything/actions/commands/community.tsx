import type { SlashCommandHandler } from './types'
import React from 'react'
import { RiDiscordLine } from '@remixicon/react'
import i18n from '@/i18n-config/i18next-config'
import { registerCommands, unregisterCommands } from './command-bus'

// Community command dependency types
type CommunityDeps = Record<string, never>

/**
 * Community command - Opens Discord community
 */
export const communityCommand: SlashCommandHandler<CommunityDeps> = {
  name: 'community',
  description: 'Open community Discord',
  mode: 'direct',

  // Direct execution function
  execute: () => {
    const url = 'https://discord.gg/5AEfbxcd9k'
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  async search(args: string, locale: string = 'en') {
    return [{
      id: 'community',
      title: i18n.t('common.userProfile.community', { lng: locale }),
      description: i18n.t('app.gotoAnything.actions.communityDesc', { lng: locale }) || 'Open Discord community',
      type: 'command' as const,
      icon: (
        <div className='flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg'>
          <RiDiscordLine className='h-4 w-4 text-text-tertiary' />
        </div>
      ),
      data: { command: 'navigation.community', args: { url: 'https://discord.gg/5AEfbxcd9k' } },
    }]
  },

  register(_deps: CommunityDeps) {
    registerCommands({
      'navigation.community': async (args) => {
        const url = args?.url || 'https://discord.gg/5AEfbxcd9k'
        window.open(url, '_blank', 'noopener,noreferrer')
      },
    })
  },

  unregister() {
    unregisterCommands(['navigation.community'])
  },
}
