import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import {
  createResourceCollector,
  getStreamedResources,
  mergeResources,
  serializeResourceUpdate,
  subscribeToStreamedResources,
} from '../streamed-resources'

it('collects only reported namespaces and active fallback languages, once per stream', async () => {
  const i18n = createInstance().use(initReactI18next)
  await i18n.init({
    lng: 'zh-Hans',
    fallbackLng: 'en-US',
    load: 'currentOnly',
    resources: {
      'zh-Hans': { common: {}, app: { title: '应用' }, workflow: { title: '流程' } },
      'en-US': { common: {}, app: { title: 'Apps' } },
      'de-DE': { app: { title: 'Apps' } },
    },
  })
  Object.assign(i18n, {
    reportNamespaces: {
      getUsedNamespaces: () => ['common', 'app', 'login'],
      addUsedNamespaces: () => {},
    },
  })
  const collect = createResourceCollector(i18n, {
    'zh-Hans': { common: {} },
    'en-US': { common: {} },
  })
  expect(collect()).toEqual({
    'zh-Hans': { app: { title: '应用' } },
    'en-US': { app: { title: 'Apps' } },
  })
  expect(collect()).toEqual({})
  i18n.addResourceBundle('en-US', 'login', { title: 'Sign in' })
  expect(collect()).toEqual({ 'en-US': { login: { title: 'Sign in' } } })
})

it('receives late resources for the matching provider without switching its language', async () => {
  const i18n = createInstance().use(initReactI18next)
  await i18n.init({ lng: 'zh-Hans', fallbackLng: false, resources: { 'zh-Hans': { common: {} } } })
  const unsubscribe = subscribeToStreamedResources('main', i18n)
  try {
    window.__difyI18nResources = {
      main: { 'en-US': { app: { title: 'Apps' } } },
      other: { 'en-US': { login: { title: 'Sign in' } } },
    }
    window.dispatchEvent(new Event('dify:i18n-resources'))
    expect(i18n.getResourceBundle('en-US', 'app')).toEqual({ title: 'Apps' })
    expect(i18n.hasResourceBundle('en-US', 'login')).toBe(false)
    expect(i18n.language).toBe('zh-Hans')
    expect(mergeResources({ 'en-US': { common: {} } }, getStreamedResources('main'))).toEqual({
      'en-US': { common: {}, app: { title: 'Apps' } },
    })
  } finally {
    unsubscribe()
    delete window.__difyI18nResources
  }
})

it('escapes translation text and provider identifiers for inline script transport', () => {
  const script = serializeResourceUpdate('</script>', {
    'en-US': { app: { title: '</script><script>alert(1)</script>&\u2028\u2029' } },
  })
  expect(script).not.toContain('</script>')
  expect(script).not.toContain('<')
  expect(script).toContain('\\u003c/script\\u003e')
  expect(script).toContain('\\u2028\\u2029')
})
