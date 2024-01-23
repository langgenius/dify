type Item = {
  value: number | string
  name: string
}

export const LanguagesSupported = ['en-US', 'zh-Hans', 'pt-BR', 'es-ES', 'fr-FR', 'de-DE', 'ja-JP', 'ko-KR', 'ru-RU', 'it-IT']
export const languages = [
  {
    value: 'en-US',
    name: 'English(United States)',
  },
  {
    value: 'zh-Hans',
    name: '简体中文',
  },
  {
    value: 'pt-BR',
    name: 'Português(Brasil)',
  },
  {
    value: 'es-ES',
    name: 'Español(España)',
  },
  {
    value: 'fr-FR',
    name: 'Français(France)',
  },
  {
    value: 'de-DE',
    name: 'Deutsch(Deutschland)',
  },
  {
    value: 'ja-JP',
    name: '日本語(日本)',
  },
  {
    value: 'ko-KR',
    name: '한국어(대한민국)',
  },
  {
    value: 'ru-RU',
    name: 'Русский(Россия)',
  },
  {
    value: 'it-IT',
    name: 'Italiano(Italia)',
  },
]

export const languageMaps = {
  'en': 'en-US',
  'zh-Hans': 'zh-Hans',
  'pt-BR': 'pt-BR',
  'es-ES': 'es-ES',
  'fr-FR': 'fr-FR',
  'de-DE': 'de-DE',
  'ja-JP': 'ja-JP',
  'ko-KR': 'ko-KR',
  'ru-RU': 'ru-RU',
  'it-IT': 'it-IT',
}

export type I18nText = {
  'en-US': string
  'zh-Hans': string
  'pt-BR': string
  'es-ES': string
  'fr-FR': string
  'de-DE': string
  'ja-JP': string
  'ko-KR': string
  'ru-RU': string
  'it-IT': string
}
