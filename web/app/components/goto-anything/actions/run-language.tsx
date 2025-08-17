import type { CommandSearchResult } from './types'
import { languages } from '@/i18n-config/language'
import { RiTranslate } from '@remixicon/react'
import i18n from '@/i18n-config/i18next-config'

export const buildLanguageCommands = (query: string): CommandSearchResult[] => {
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

export const buildLanguageRootItem = (): CommandSearchResult => {
  return {
    id: 'category-language',
    title: i18n.t('app.gotoAnything.actions.languageCategoryTitle'),
    description: i18n.t('app.gotoAnything.actions.languageCategoryDesc'),
    type: 'command',
    icon: (
      <div className='flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg'>
        <RiTranslate className='h-4 w-4 text-text-tertiary' />
      </div>
    ),
    data: { command: 'nav.search', args: { query: '@run language ' } },
  }
}
