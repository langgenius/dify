import type { SlashCommandHandler } from './types'
import type { CommandSearchResult } from '../types'
import { languages } from '@/i18n-config/language'
import i18n from '@/i18n-config/i18next-config'
import { registerCommands, unregisterCommands } from './command-bus'

// Language dependency types
type LanguageDeps = {
  setLocale?: (locale: string) => Promise<void>
}

const buildLanguageCommands = (query: string): CommandSearchResult[] => {
  const q = query.toLowerCase()
  const list = languages.filter(item => item.supported && (
    !q || item.name.toLowerCase().includes(q) || String(item.value).toLowerCase().includes(q)
  ))
  return list.map(item => ({
    id: `lang-${item.value}`,
    title: item.name,
    description: i18n.t('app.gotoAnything.actions.languageChangeDesc'),
    type: 'command' as const,
    data: { command: 'i18n.set', args: { locale: item.value } },
  }))
}

/**
 * Language command handler
 * Integrates UI building, search, and registration logic
 */
export const languageCommand: SlashCommandHandler<LanguageDeps> = {
  name: 'language',
  aliases: ['lang'],
  description: 'Switch between different languages',
  mode: 'submenu', // Explicitly set submenu mode

  async search(args: string, _locale: string = 'en') {
    // Return language options directly, regardless of parameters
    return buildLanguageCommands(args)
  },

  register(deps: LanguageDeps) {
    registerCommands({
      'i18n.set': async (args) => {
        const locale = args?.locale
        if (locale)
          await deps.setLocale?.(locale)
      },
    })
  },

  unregister() {
    unregisterCommands(['i18n.set'])
  },
}
