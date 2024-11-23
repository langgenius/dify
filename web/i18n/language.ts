import data from './languages.json'
export type Item = {
  value: number | string
  name: string
  example: string
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
  'uk-UA': string
  'vi-VN': string
  'de_DE': string
  'zh_Hant': string
  'ro-RO': string
  'pl-PL': string
  'hi-IN': string
  'fa-IR': string
  'sl-SI': string
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
    zh_Hans: '重要公告',
    pt_BR: 'Aviso Importante',
    es_ES: 'Aviso Importante',
    fr_FR: 'Avis important',
    de_DE: 'Wichtiger Hinweis',
    ja_JP: '重要なお知らせ',
    ko_KR: '중요 공지',
    pl_PL: 'Ważne ogłoszenie',
    uk_UA: 'Важливе повідомлення',
    ru_RU: 'Важное Уведомление',
    vi_VN: 'Thông báo quan trọng',
    it_IT: 'Avviso Importante',
    fa_IR: 'هشدار مهم',
    sl_SI: 'Pomembno obvestilo',
  },
  desc: {
    en_US:
      'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
    zh_Hans:
      '为了有效提升数据检索能力及稳定性，Dify 将于 2023 年 8 月 29 日 03:00 至 08:00 期间进行服务升级，届时 Dify 云端版及应用将无法访问。感谢您的耐心与支持。',
    pt_BR:
      'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
    es_ES:
      'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
    fr_FR:
      'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
    de_DE:
      'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
    ja_JP:
      'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
    ko_KR:
      '시스템이 업그레이드를 위해 UTC 시간대로 8월 28일 19:00 ~ 24:00에 사용 불가될 예정입니다. 질문이 있으시면 지원 팀에 연락주세요 (support@dify.ai). 최선을 다해 답변해드리겠습니다.',
    pl_PL:
      'Nasz system będzie niedostępny od 19:00 do 24:00 UTC 28 sierpnia w celu aktualizacji. W przypadku pytań prosimy o kontakt z naszym zespołem wsparcia (support@dify.ai). Doceniamy Twoją cierpliwość.',
    uk_UA:
      'Наша система буде недоступна з 19:00 до 24:00 UTC 28 серпня для оновлення. Якщо у вас виникнуть запитання, будь ласка, зв’яжіться з нашою службою підтримки (support@dify.ai). Дякуємо за терпіння.',
    ru_RU:
      'Наша система будет недоступна с 19:00 до 24:00 UTC 28 августа для обновления. По вопросам, пожалуйста, обращайтесь в нашу службу поддержки (support@dify.ai). Спасибо за ваше терпение',
    vi_VN:
      'Hệ thống của chúng tôi sẽ ngừng hoạt động từ 19:00 đến 24:00 UTC vào ngày 28 tháng 8 để nâng cấp. Nếu có thắc mắc, vui lòng liên hệ với nhóm hỗ trợ của chúng tôi (support@dify.ai). Chúng tôi đánh giá cao sự kiên nhẫn của bạn.',
    tr_TR:
      'Sistemimiz, 28 Ağustos\'ta 19:00 ile 24:00 UTC saatleri arasında güncelleme nedeniyle kullanılamayacaktır. Sorularınız için lütfen destek ekibimizle iletişime geçin (support@dify.ai). Sabrınız için teşekkür ederiz.',
    fa_IR:
      'سیستم ما از ساعت 19:00 تا 24:00 UTC در تاریخ 28 اوت برای ارتقاء در دسترس نخواهد بود. برای سؤالات، لطفاً با تیم پشتیبانی ما (support@dify.ai) تماس بگیرید. ما برای صبر شما ارزش قائلیم.',
    sl_SI:
      'Naš sistem ne bo na voljo od 19:00 do 24:00 UTC 28. avgusta zaradi nadgradnje. Za vprašanja se obrnite na našo skupino za podporo (support@dify.ai). Cenimo vašo potrpežljivost.',
  },
  href: '#',
}
