import type { SlashCommandHandler } from './types'
import { getI18n } from 'react-i18next'
import { defaultDocBaseUrl, getDocHomePath } from '@/context/i18n'
import { getDocLanguage } from '@/i18n-config/language'
import { registerCommands, unregisterCommands } from './command-bus'

// Documentation command dependency types - no external dependencies needed
type DocDeps = Record<string, never>

const getDocsHomeUrl = () => {
  const i18n = getI18n()
  const currentLocale = i18n.language
  const docLanguage = getDocLanguage(currentLocale)
  return `${defaultDocBaseUrl}/${docLanguage}${getDocHomePath()}`
}

/**
 * Documentation command - Opens help documentation
 */
export const docsCommand: SlashCommandHandler<DocDeps> = {
  name: 'docs',
  description: 'Open documentation',
  mode: 'direct',

  // Direct execution function
  execute: () => {
    window.open(getDocsHomeUrl(), '_blank', 'noopener,noreferrer')
  },

  search(args: string, locale: string = 'en') {
    const i18n = getI18n()
    return [
      {
        id: 'doc',
        title: i18n.t(($) => $['userProfile.helpCenter'], { ns: 'common', lng: locale }),
        description:
          i18n.t(($) => $['gotoAnything.actions.docDesc'], { ns: 'app', lng: locale }) ||
          'Open help documentation',
        type: 'command' as const,
        icon: (
          <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
            <span aria-hidden className="i-ri-book-open-line size-4 text-text-tertiary" />
          </div>
        ),
        data: { command: 'navigation.doc', args: {} },
      },
    ]
  },

  register(_deps: DocDeps) {
    registerCommands({
      'navigation.doc': async (_args) => {
        window.open(getDocsHomeUrl(), '_blank', 'noopener,noreferrer')
      },
    })
  },

  unregister() {
    unregisterCommands(['navigation.doc'])
  },
}
