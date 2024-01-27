export type Item = {
  value: number | string
  name: string
}

export const LanguagesSupported = ['en-US', 'zh-Hans', 'pt-BR', 'es-ES', 'fr-FR', 'de-DE', 'ja-JP', 'ko-KR', 'ru-RU', 'it-IT']
export const LanguagesSupportedUnderscore = ['en_US', 'zh_Hans', 'pt_BR', 'es_ES', 'fr_FR', 'de_DE', 'ja_JP', 'ko_KR', 'ru_RU', 'it_IT']

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
  // {
  //   value: 'es-ES',
  //   name: 'Español(España)',
  // },
  // {
  //   value: 'fr-FR',
  //   name: 'Français(France)',
  // },
  // {
  //   value: 'de-DE',
  //   name: 'Deutsch(Deutschland)',
  // },
  // {
  //   value: 'ja-JP',
  //   name: '日本語(日本)',
  // },
  // {
  //   value: 'ko-KR',
  //   name: '한국어(대한민국)',
  // },
  // {
  //   value: 'ru-RU',
  //   name: 'Русский(Россия)',
  // },
  // {
  //   value: 'it-IT',
  //   name: 'Italiano(Italia)',
  // },
]

export const getModelRuntimeSupported = (locale: string) => {
  if (locale === 'zh-Hans')
    return locale.replace('-', '_')

  return LanguagesSupported[0].replace('-', '_')
}
export const languageMaps = {
  'en-US': 'en-US',
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

export const NOTICE_I18N = {
  title: {
    en_US: 'Important Notice',
    zh_Hans: '重要公告',
    pt_BR: 'Aviso Importante',
    es_ES: 'Aviso Importante',
    fr_FR: 'Avis important',
    de_DE: 'Wichtiger Hinweis',
    ja_JP: '重要なお知らせ',
    ko_KR: '중요 공지',
  },
  desc: {
    en_US: 'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
    zh_Hans: '为了有效提升数据检索能力及稳定性，Dify 将于 2023 年 8 月 29 日 03:00 至 08:00 期间进行服务升级，届时 Dify 云端版及应用将无法访问。感谢您的耐心与支持。',
    pt_BR: 'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
    es_ES: 'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
    fr_FR: 'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
    de_DE: 'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
    ja_JP: 'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
    ko_KR: 'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
  },
  href: '#',
}
