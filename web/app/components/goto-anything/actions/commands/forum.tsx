import type { SlashCommandHandler } from './types'
import React from 'react'
import { RiFeedbackLine } from '@remixicon/react'
import i18n from '@/i18n-config/i18next-config'
import { registerCommands, unregisterCommands } from './command-bus'

// Forum command dependency types
type ForumDeps = Record<string, never>

/**
 * Forum command - Opens Dify community forum
 */
export const forumCommand: SlashCommandHandler<ForumDeps> = {
  name: 'forum',
  description: 'Open Dify community forum',
  mode: 'direct',

  // Direct execution function
  execute: () => {
    const url = 'https://forum.dify.ai'
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  async search(args: string, locale: string = 'en') {
    return [{
      id: 'forum',
      title: i18n.t('common.userProfile.forum', { lng: locale }),
      description: i18n.t('app.gotoAnything.actions.feedbackDesc', { lng: locale }) || 'Open community feedback discussions',
      type: 'command' as const,
      icon: (
        <div className='flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg'>
          <RiFeedbackLine className='h-4 w-4 text-text-tertiary' />
        </div>
      ),
      data: { command: 'navigation.forum', args: { url: 'https://forum.dify.ai' } },
    }]
  },

  register(_deps: ForumDeps) {
    registerCommands({
      'navigation.forum': async (args) => {
        const url = args?.url || 'https://forum.dify.ai'
        window.open(url, '_blank', 'noopener,noreferrer')
      },
    })
  },

  unregister() {
    unregisterCommands(['navigation.forum'])
  },
}
