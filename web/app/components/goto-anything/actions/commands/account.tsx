import type { SlashCommandHandler } from './types'
import { RiUser3Line } from '@remixicon/react'
import * as React from 'react'
import { getI18n } from 'react-i18next'
import { registerCommands, unregisterCommands } from './command-bus'

// Account command dependency types - no external dependencies needed
type AccountDeps = Record<string, never>

/**
 * Account command - Navigates to account page
 */
export const accountCommand: SlashCommandHandler<AccountDeps> = {
  name: 'account',
  description: 'Navigate to account page',
  mode: 'direct',

  // Direct execution function
  execute: () => {
    window.location.href = '/account'
  },

  async search(args: string, locale: string = 'en') {
    const i18n = getI18n()
    return [{
      id: 'account',
      title: i18n.t('account.account', { ns: 'common', lng: locale }),
      description: i18n.t('gotoAnything.actions.accountDesc', { ns: 'app', lng: locale }),
      type: 'command' as const,
      icon: (
        <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
          <RiUser3Line className="h-4 w-4 text-text-tertiary" />
        </div>
      ),
      data: { command: 'navigation.account', args: {} },
    }]
  },

  register(_deps: AccountDeps) {
    registerCommands({
      'navigation.account': async (_args) => {
        // Navigate to account page
        window.location.href = '/account'
      },
    })
  },

  unregister() {
    unregisterCommands(['navigation.account'])
  },
}
