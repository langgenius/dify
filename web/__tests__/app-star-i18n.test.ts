import fs from 'node:fs'
import path from 'node:path'

const I18N_DIR = path.join(__dirname, '../i18n')

const REQUIRED_APP_STAR_KEYS = [
  'studio.allApps',
  'studio.starApp',
  'studio.starFailed',
  'studio.starred',
  'studio.unstarApp',
] as const

type AppTranslations = Record<string, unknown>

const getSupportedLocales = () => fs.readdirSync(I18N_DIR)
  .filter(item => fs.statSync(path.join(I18N_DIR, item)).isDirectory())
  .sort()

const loadAppTranslations = (locale: string): AppTranslations => {
  const filePath = path.join(I18N_DIR, locale, 'app.json')

  if (!fs.existsSync(filePath))
    throw new Error(`Translation file not found: ${filePath}`)

  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AppTranslations
}

describe('App star i18n translations', () => {
  it('should define star-related app list labels for every locale', () => {
    const supportedLocales = getSupportedLocales()

    const missingKeys = supportedLocales.flatMap((locale) => {
      const translations = loadAppTranslations(locale)

      return REQUIRED_APP_STAR_KEYS
        .filter((key) => {
          const value = translations[key]
          return typeof value !== 'string' || value.trim() === ''
        })
        .map(key => `${locale}:${key}`)
    })

    expect(supportedLocales.length).toBeGreaterThan(0)
    expect(missingKeys).toEqual([])
  })
})
