import type { SlashCommandHandler } from './types'
import { getI18n } from 'react-i18next'
import { registerCommands, unregisterCommands } from './command-bus'

type DocDeps = {
  getDocsHomeUrl: () => string
}

let getDocsHomeUrl: (() => string) | undefined

const openDocsHome = () => {
  const url = getDocsHomeUrl?.()
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
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
    openDocsHome()
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

  register(deps: DocDeps) {
    getDocsHomeUrl = deps.getDocsHomeUrl
    registerCommands({
      'navigation.doc': async (_args) => {
        openDocsHome()
      },
    })
  },

  unregister() {
    getDocsHomeUrl = undefined
    unregisterCommands(['navigation.doc'])
  },
}
