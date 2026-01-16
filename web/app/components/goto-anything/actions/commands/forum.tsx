import type { SlashCommandHandler } from './types'
import { RiFeedbackLine } from '@remixicon/react'
import * as React from 'react'
import { getI18n } from 'react-i18next'
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
    const i18n = getI18n()
    return [{
      id: 'forum',
      title: i18n.t('userProfile.forum', { ns: 'common', lng: locale }),
      description: i18n.t('gotoAnything.actions.feedbackDesc', { ns: 'app', lng: locale }) || 'Open community feedback discussions',
      type: 'command' as const,
      icon: (
        <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
          <RiFeedbackLine className="h-4 w-4 text-text-tertiary" />
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
