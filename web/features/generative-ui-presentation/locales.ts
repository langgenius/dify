import data from '@/i18n/languages'

export const presentationLanguages = data.languages.filter(
  (language) =>
    language.value === 'zh-Hans' || language.value === 'ja-JP' || language.value === 'en-US',
)

export type PresentationLocale = (typeof presentationLanguages)[number]['value']
