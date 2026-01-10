import type { SlashCommandHandler } from './types'
import { RiBookOpenLine } from '@remixicon/react'
import * as React from 'react'
import { getI18n } from 'react-i18next'
import { defaultDocBaseUrl } from '@/context/i18n'
import { getDocLanguage } from '@/i18n-config/language'
import { registerCommands, unregisterCommands } from './command-bus'

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
    const i18n = getI18n()
    const currentLocale = i18n.language
    const docLanguage = getDocLanguage(currentLocale)
    const url = `${defaultDocBaseUrl}/${docLanguage}`
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  async search(args: string, locale: string = 'en') {
    const i18n = getI18n()
    return [{
      id: 'doc',
      title: i18n.t('userProfile.helpCenter', { ns: 'common', lng: locale }),
      description: i18n.t('gotoAnything.actions.docDesc', { ns: 'app', lng: locale }) || 'Open help documentation',
      type: 'command' as const,
      icon: (
        <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
          <RiBookOpenLine className="h-4 w-4 text-text-tertiary" />
        </div>
      ),
      data: { command: 'navigation.doc', args: {} },
    }]
  },

  register(_deps: DocDeps) {
    const i18n = getI18n()
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
