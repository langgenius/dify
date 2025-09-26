import type { SlashCommandHandler } from './types'
import React from 'react'
import { RiBookOpenLine } from '@remixicon/react'
import i18n from '@/i18n-config/i18next-config'
import { registerCommands, unregisterCommands } from './command-bus'
import { defaultDocBaseUrl } from '@/context/i18n'
import { getDocLanguage } from '@/i18n-config/language'

// Documentation command dependency types - no external dependencies needed
type DocDeps = Record<string, never>

/**
 * Documentation command - Opens help documentation
 */
export const docsCommand: SlashCommandHandler<DocDeps> = {
  name: 'docs',
  description: 'Open documentation',
  mode: 'direct',

  // Direct execution function
  execute: () => {
    const currentLocale = i18n.language
    const docLanguage = getDocLanguage(currentLocale)
    const url = `${defaultDocBaseUrl}/${docLanguage}`
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  async search(args: string, locale: string = 'en') {
    return [{
      id: 'doc',
      title: i18n.t('common.userProfile.helpCenter', { lng: locale }),
      description: i18n.t('app.gotoAnything.actions.docDesc', { lng: locale }) || 'Open help documentation',
      type: 'command' as const,
      icon: (
        <div className='flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg'>
          <RiBookOpenLine className='h-4 w-4 text-text-tertiary' />
        </div>
      ),
      data: { command: 'navigation.doc', args: {} },
    }]
  },

  register(_deps: DocDeps) {
    registerCommands({
      'navigation.doc': async (_args) => {
        // Get the current language from i18n
        const currentLocale = i18n.language
        const docLanguage = getDocLanguage(currentLocale)
        const url = `${defaultDocBaseUrl}/${docLanguage}`
        window.open(url, '_blank', 'noopener,noreferrer')
      },
    })
  },

  unregister() {
    unregisterCommands(['navigation.doc'])
  },
}
