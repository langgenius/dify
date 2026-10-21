import fs from 'node:fs'
import path from 'node:path'

it('localizes every availability label and preserves the app-name interpolation in all supported locales', () => {
  const directory = path.join(__dirname, '../i18n/locales')
  const english = JSON.parse(
    fs.readFileSync(path.join(directory, 'en-US/app.json'), 'utf8'),
  ) as Record<string, string>
  const keys = Object.keys(english).filter((key) => key.startsWith('studio.availability.'))
  const locales = fs
    .readdirSync(directory)
    .filter((locale) => fs.statSync(path.join(directory, locale)).isDirectory())
  expect(keys.length).toBeGreaterThan(0)
  for (const locale of locales) {
    const translations = JSON.parse(
      fs.readFileSync(path.join(directory, locale, 'app.json'), 'utf8'),
    ) as Record<string, string>
    for (const key of keys) expect(translations[key], `${locale}:${key}`).toBeTruthy()
    expect(translations['studio.availability.details'], locale).toContain('{{name}}')
  }
})
