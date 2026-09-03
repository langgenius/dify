import { describe, expect, it } from 'vitest'
import { languages, LanguagesSupported, localeMap } from '../language'
import { loadI18nResource } from '../load-resource'

describe('Swedish locale registration', () => {
  it('lists Swedish as a supported locale with a Day.js locale mapping', () => {
    expect(LanguagesSupported).toContain('sv-SE')
    expect(languages).toContainEqual(expect.objectContaining({ value: 'sv-SE', supported: true }))
    expect(localeMap['sv-SE']).toBe('sv')
  })

  it('loads the Swedish workflow resources', async () => {
    const resource = await loadI18nResource('sv-SE', 'workflow')
    const translations = resource.default as Record<string, string>

    expect(translations['common.publish']).toBe('Publicera')
    expect(translations['nodes.common.errorHandle.title']).toBe('Felhantering')
  })
})
