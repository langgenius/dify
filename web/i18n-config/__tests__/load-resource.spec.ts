import { loadI18nResource } from '../load-resource'

describe('loadI18nResource', () => {
  it('loads the localized Contacts namespace for Simplified Chinese', async () => {
    const resource = await loadI18nResource('zh-Hans', 'contacts')

    expect(resource.default).toMatchObject({ 'imPlatform.title': 'IM 平台' })
  })

  it('falls back to English for Contacts locales outside the confirmed scope', async () => {
    const resource = await loadI18nResource('fr-FR', 'contacts')

    expect(resource.default).toMatchObject({ 'imPlatform.title': 'IM Platforms' })
  })

  it('keeps loading existing localized resources for other namespaces', async () => {
    const resource = await loadI18nResource('zh-Hans', 'common')

    expect(resource.default).toMatchObject({ 'operation.cancel': '取消' })
  })
})
