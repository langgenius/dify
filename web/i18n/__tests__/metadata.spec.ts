import { getModelLanguage, getPluginLanguage, renderI18nObject } from '../metadata'

describe('localized metadata', () => {
  it('preserves separate plugin and model language support', () => {
    expect(getPluginLanguage('pt-BR')).toBe('pt_BR')
    expect(getPluginLanguage('fr-FR')).toBe('en_US')
    expect(getModelLanguage('fr-FR')).toBe('fr_FR')
    expect(getPluginLanguage('zh-Hans')).toBe('zh_Hans')
    expect(getPluginLanguage('ja-JP')).toBe('ja_JP')
  })

  it('prefers requested copy, then English, then the first available translation', () => {
    const copy = { zh_Hans: '中文', en_US: 'English', fr_FR: 'Français' }
    expect(renderI18nObject(copy, 'fr_FR')).toBe('Français')
    expect(renderI18nObject(copy, 'ja_JP')).toBe('English')
    expect(renderI18nObject({ zh_Hans: '', fr_FR: 'Français' }, 'ja_JP')).toBe('Français')
    expect(renderI18nObject(null, 'en_US')).toBe('')
  })
})
