import type { SlashCommandHandler } from './types'
import React from 'react'
import { RiFeedbackLine } from '@remixicon/react'
import i18n from '@/i18n-config/i18next-config'
import { registerCommands, unregisterCommands } from './command-bus'

// Feedback command dependency types
type FeedbackDeps = Record<string, never>

/**
 * Feedback command - Opens GitHub feedback discussions
 */
export const feedbackCommand: SlashCommandHandler<FeedbackDeps> = {
  name: 'feedback',
  description: 'Open feedback discussions',
  mode: 'direct',

  // Direct execution function
  execute: () => {
    const url = 'https://github.com/langgenius/dify/discussions/categories/feedbacks'
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  async search(args: string, locale: string = 'en') {
    return [{
      id: 'feedback',
      title: i18n.t('common.userProfile.communityFeedback', { lng: locale }),
      description: i18n.t('app.gotoAnything.actions.feedbackDesc', { lng: locale }) || 'Open community feedback discussions',
      type: 'command' as const,
      icon: (
        <div className='flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg'>
          <RiFeedbackLine className='h-4 w-4 text-text-tertiary' />
        </div>
      ),
      data: { command: 'navigation.feedback', args: { url: 'https://github.com/langgenius/dify/discussions/categories/feedbacks' } },
    }]
  },

  register(_deps: FeedbackDeps) {
    registerCommands({
      'navigation.feedback': async (args) => {
        const url = args?.url || 'https://github.com/langgenius/dify/discussions/categories/feedbacks'
        window.open(url, '_blank', 'noopener,noreferrer')
      },
    })
  },

  unregister() {
    unregisterCommands(['navigation.feedback'])
  },
}
