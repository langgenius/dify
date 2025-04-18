import data from './languages.json'
export type Item = {
  value: number | string
  name: string
  example: string
}

export type I18nText = {
  'en-US': string
  'ru-RU': string
}

export const languages = data.languages

export const LanguagesSupported = languages.filter(item => item.supported).map(item => item.value)

export const getLanguage = (locale: string) => {
  if (locale === 'zh-Hans')
    return locale.replace('-', '_')

  return LanguagesSupported[0].replace('-', '_')
}

export const NOTICE_I18N = {
  title: {
    en_US: 'Important Notice',
    ru_RU: 'Важное Уведомление',
  },
  desc: {
    en_US:
      'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
    ru_RU:
      'Наша система будет недоступна с 19:00 до 24:00 UTC 28 августа для обновления. По вопросам, пожалуйста, обращайтесь в нашу службу поддержки (support@dify.ai). Спасибо за ваше терпение',
  },
  href: '#',
}
