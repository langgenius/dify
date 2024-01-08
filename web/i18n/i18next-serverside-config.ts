import { createInstance } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import { initReactI18next } from 'react-i18next/initReactI18next'
import type { Locale } from '.'

// https://locize.com/blog/next-13-app-dir-i18n/
const initI18next = async (lng: Locale, ns: string) => {
  const i18nInstance = createInstance()
  await i18nInstance
    .use(initReactI18next)
    .use(resourcesToBackend((language: string, namespace: string) => import(`./lang/${namespace}.${language}.ts`)))
    .init({
      lng: lng === 'zh-Hans' ? 'zh' : lng,
      ns,
      fallbackLng: 'en',
    })
  return i18nInstance
}

export async function useTranslation(lng: Locale, ns = '', options: Record<string, any> = {}) {
  const i18nextInstance = await initI18next(lng, ns)
  return {
    t: i18nextInstance.getFixedT(lng, ns, options.keyPrefix),
    i18n: i18nextInstance,
  }
}
