import { loadI18nResource } from '../load-resource'

describe('locale resource loading', () => {
  it.each([
    ['en_US', 'Save'],
    ['zh_Hans', '保存'],
    ['ja_JP', '保存'],
    ['ZH-hans', '保存'],
    ['en--US', 'Save'],
    ['unsupported', 'Save'],
  ])('loads usable translations for %s', async (locale, expected) => {
    const resource = await loadI18nResource(locale, 'common')

    expect(resource.default).toMatchObject({ 'operation.save': expected })
  })
})
