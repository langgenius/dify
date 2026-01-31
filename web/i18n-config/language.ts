import type { DocLanguage } from '@/types/doc-paths'
import data from './languages'

export type Item = {
  value: number | string
  name: string
  example: string
}

export type I18nText = Record<typeof LanguagesSupported[number], string>

export const languages = data.languages

// for compatibility
export type Locale = 'ja_JP' | 'zh_Hans' | 'en_US' | (typeof languages[number])['value']

export const LanguagesSupported: Locale[] = languages.filter(item => item.supported).map(item => item.value)

export const getLanguage = (locale: Locale): Locale => {
  if (['zh-Hans', 'ja-JP'].includes(locale))
    return locale.replace('-', '_') as Locale

  return LanguagesSupported[0].replace('-', '_') as Locale
}

const DOC_LANGUAGE: Record<string, DocLanguage | undefined> = {
  'zh-Hans': 'zh',
  'ja-JP': 'ja',
  'en-US': 'en',
}

export const localeMap: Record<Locale, string> = {
  'en-US': 'en',
  'en_US': 'en',
  'zh-Hans': 'zh-cn',
  'zh_Hans': 'zh-cn',
  'zh-Hant': 'zh-tw',
  'pt-BR': 'pt-br',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'de-DE': 'de',
  'ja-JP': 'ja',
  'ja_JP': 'ja',
  'ko-KR': 'ko',
  'ru-RU': 'ru',
  'it-IT': 'it',
  'th-TH': 'th',
  'id-ID': 'id',
  'uk-UA': 'uk',
  'vi-VN': 'vi',
  'ro-RO': 'ro',
  'pl-PL': 'pl',
  'hi-IN': 'hi',
  'tr-TR': 'tr',
  'fa-IR': 'fa',
  'sl-SI': 'sl',
  'ar-TN': 'ar',
}

export const getDocLanguage = (locale: string): DocLanguage => {
  return DOC_LANGUAGE[locale] || 'en'
}

const PRICING_PAGE_LANGUAGE: Record<string, string> = {
  'ja-JP': 'jp',
}

export const getPricingPageLanguage = (locale: string) => {
  return PRICING_PAGE_LANGUAGE[locale] || ''
}

export const NOTICE_I18N = {
  title: {
    en_US: 'Important Notice',
    zh_Hans: '重要公告',
    zh_Hant: '重要公告',
    pt_BR: 'Aviso Importante',
    es_ES: 'Aviso Importante',
    fr_FR: 'Avis important',
    de_DE: 'Wichtiger Hinweis',
    ja_JP: '重要なお知らせ',
    ko_KR: '중요 공지',
    ru_RU: 'Важное Уведомление',
    it_IT: 'Avviso Importante',
    th_TH: 'ประกาศสำคัญ',
    id_ID: 'Pengumuman Penting',
    uk_UA: 'Важливе повідомлення',
    vi_VN: 'Thông báo quan trọng',
    ro_RO: 'Anunț Important',
    pl_PL: 'Ważne ogłoszenie',
    hi_IN: 'महत्वपूर्ण सूचना',
    tr_TR: 'Önemli Duyuru',
    fa_IR: 'هشدار مهم',
    sl_SI: 'Pomembno obvestilo',
    ar_TN: 'إشعار مهم',
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
      '시스템이 업그레이드를 위해 UTC 시간대로 8 월 28 일 19:00 ~ 24:00 에 사용 불가될 예정입니다. 질문이 있으시면 지원 팀에 연락주세요 (support@dify.ai). 최선을 다해 답변해드리겠습니다.',
    pl_PL:
      'Nasz system będzie niedostępny od 19:00 do 24:00 UTC 28 sierpnia w celu aktualizacji. W przypadku pytań prosimy o kontakt z naszym zespołem wsparcia (support@dify.ai). Doceniamy Twoją cierpliwość.',
    uk_UA:
      'Наша система буде недоступна з 19:00 до 24:00 UTC 28 серпня для оновлення. Якщо у вас виникнуть запитання, будь ласка, зв’яжіться з нашою службою підтримки (support@dify.ai). Дякуємо за терпіння.',
    ru_RU:
      'Наша система будет недоступна с 19:00 до 24:00 UTC 28 августа для обновления. По вопросам, пожалуйста, обращайтесь в нашу службу поддержки (support@dify.ai). Спасибо за ваше терпение',
    vi_VN:
      'Hệ thống của chúng tôi sẽ ngừng hoạt động từ 19:00 đến 24:00 UTC vào ngày 28 tháng 8 để nâng cấp. Nếu có thắc mắc, vui lòng liên hệ với nhóm hỗ trợ của chúng tôi (support@dify.ai). Chúng tôi đánh giá cao sự kiên nhẫn của bạn.',
    id_ID:
      'Sistem kami tidak akan tersedia dari 19:00 hingga 24:00 UTC pada 28 Agustus untuk pemutakhiran. Untuk pertanyaan, silakan hubungi tim dukungan kami (support@dify.ai). Kami menghargai kesabaran Anda.',
    tr_TR:
      'Sistemimiz, 28 Ağustos\'ta 19:00 ile 24:00 UTC saatleri arasında güncelleme nedeniyle kullanılamayacaktır. Sorularınız için lütfen destek ekibimizle iletişime geçin (support@dify.ai). Sabrınız için teşekkür ederiz.',
    fa_IR:
      'سیستم ما از ساعت 19:00 تا 24:00 UTC در تاریخ 28 اوت برای ارتقاء در دسترس نخواهد بود. برای سؤالات، لطفاً با تیم پشتیبانی ما (support@dify.ai) تماس بگیرید. ما برای صبر شما ارزش قائلیم.',
    sl_SI:
      'Naš sistem ne bo na voljo od 19:00 do 24:00 UTC 28. avgusta zaradi nadgradnje. Za vprašanja se obrnite na našo skupino za podporo (support@dify.ai). Cenimo vašo potrpežljivost.',
    th_TH:
      'ระบบของเราจะไม่สามารถใช้งานได้ตั้งแต่เวลา 19:00 ถึง 24:00 UTC ในวันที่ 28 สิงหาคม เพื่อทำการอัปเกรด หากมีคำถามใดๆ กรุณาติดต่อทีมสนับสนุนของเรา (support@dify.ai) เราขอขอบคุณในความอดทนของท่าน',
    ar_TN:
      'سيكون نظامنا غير متاح من الساعة 19:00 إلى 24:00 بالتوقيت العالمي المنسق في 28 أغسطس لإجراء ترقية. للأسئلة، يرجى الاتصال بفريق الدعم لدينا (support@dify.ai). نحن نقدر صبرك.',
  },
  href: '#',
}
