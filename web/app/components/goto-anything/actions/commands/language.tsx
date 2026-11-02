import type { CommandSearchResult } from '../types'
import type { CommandContext, SlashCommand } from './types'
import { languages } from '@/i18n/language'

const buildLanguageCommands = (query: string, context: CommandContext): CommandSearchResult[] => {
  const q = query.toLowerCase()
  const list = languages.filter(
    (item) =>
      item.supported &&
      (!q || item.name.toLowerCase().includes(q) || String(item.value).toLowerCase().includes(q)),
  )
  return list.map((item) => ({
    id: `lang-${item.value}`,
    title: item.name,
    description: context.t(($) => $['gotoAnything.actions.languageChangeDesc'], {
      ns: 'app',
      lng: context.locale,
    }),
    type: 'command' as const,
    data: { command: 'language', args: { locale: item.value } },
  }))
}

/**
 * Language command handler
 */
export const languageCommand: SlashCommand = {
  name: 'language',
  aliases: ['lang'],
  description: 'Switch between different languages',
  mode: 'submenu',
  async execute(args, context) {
    const language = languages.find((item) => item.supported && item.value === args.locale)
    if (language) await context.setLocale(language.value)
  },

  search(args: string, context) {
    return buildLanguageCommands(args, context)
  },
}
