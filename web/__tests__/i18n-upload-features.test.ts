/**
 * Test suite for verifying upload feature translations across all locales
 * Specifically tests for issue #23062: Missing Upload feature translations (esp. audioUpload) across most locales
 */

import fs from 'node:fs'
import path from 'node:path'

// Get all supported locales from the i18n directory
const I18N_DIR = path.join(__dirname, '../i18n')
const getSupportedLocales = (): string[] => {
  return fs.readdirSync(I18N_DIR)
    .filter(item => fs.statSync(path.join(I18N_DIR, item)).isDirectory())
    .sort()
}

// Helper function to load translation file content
const loadTranslationContent = (locale: string): string => {
  const filePath = path.join(I18N_DIR, locale, 'app-debug.json')

  if (!fs.existsSync(filePath))
    throw new Error(`Translation file not found: ${filePath}`)

  return fs.readFileSync(filePath, 'utf-8')
}

// Helper function to check if upload features exist (supports flattened JSON)
const hasUploadFeatures = (content: string): { [key: string]: boolean } => {
  return {
    fileUpload: /"feature\.fileUpload\.title"/.test(content),
    imageUpload: /"feature\.imageUpload\.title"/.test(content),
    documentUpload: /"feature\.documentUpload\.title"/.test(content),
    audioUpload: /"feature\.audioUpload\.title"/.test(content),
    featureBar: /"feature\.bar\.empty"/.test(content),
  }
}

describe('Upload Features i18n Translations - Issue #23062', () => {
  let supportedLocales: string[]

  beforeAll(() => {
    supportedLocales = getSupportedLocales()
    console.log(`Testing ${supportedLocales.length} locales for upload features`)
  })

  it('all locales should have translation files', () => {
    supportedLocales.forEach((locale) => {
      const filePath = path.join(I18N_DIR, locale, 'app-debug.json')
      expect(fs.existsSync(filePath)).toBe(true)
    })
  })

  it('all locales should have required upload features', () => {
    const results: { [locale: string]: { [feature: string]: boolean } } = {}

    supportedLocales.forEach((locale) => {
      const content = loadTranslationContent(locale)
      const features = hasUploadFeatures(content)
      results[locale] = features

      // Check that all upload features exist
      expect(features.fileUpload).toBe(true)
      expect(features.imageUpload).toBe(true)
      expect(features.documentUpload).toBe(true)
      expect(features.audioUpload).toBe(true)
      expect(features.featureBar).toBe(true)
    })

    console.log('✅ All locales have complete upload features')
  })

  it('previously missing locales should now have audioUpload - Issue #23062', () => {
    // These locales were specifically missing audioUpload
    const previouslyMissingLocales = ['fa-IR', 'hi-IN', 'ro-RO', 'sl-SI', 'th-TH', 'uk-UA', 'vi-VN']

    previouslyMissingLocales.forEach((locale) => {
      const content = loadTranslationContent(locale)

      // Verify audioUpload exists with title and description (flattened JSON format)
      expect(/"feature\.audioUpload\.title"/.test(content)).toBe(true)
      expect(/"feature\.audioUpload\.description"/.test(content)).toBe(true)

      console.log(`✅ ${locale} - Issue #23062 resolved: audioUpload feature present`)
    })
  })

  it('upload features should have required properties', () => {
    supportedLocales.forEach((locale) => {
      const content = loadTranslationContent(locale)

      // Check fileUpload has required properties (flattened JSON format)
      if (/"feature\.fileUpload\.title"/.test(content)) {
        expect(/"feature\.fileUpload\.title"/.test(content)).toBe(true)
        expect(/"feature\.fileUpload\.description"/.test(content)).toBe(true)
      }

      // Check imageUpload has required properties
      if (/"feature\.imageUpload\.title"/.test(content)) {
        expect(/"feature\.imageUpload\.title"/.test(content)).toBe(true)
        expect(/"feature\.imageUpload\.description"/.test(content)).toBe(true)
      }

      // Check documentUpload has required properties
      if (/"feature\.documentUpload\.title"/.test(content)) {
        expect(/"feature\.documentUpload\.title"/.test(content)).toBe(true)
        expect(/"feature\.documentUpload\.description"/.test(content)).toBe(true)
      }

      // Check audioUpload has required properties
      if (/"feature\.audioUpload\.title"/.test(content)) {
        expect(/"feature\.audioUpload\.title"/.test(content)).toBe(true)
        expect(/"feature\.audioUpload\.description"/.test(content)).toBe(true)
      }
    })
  })
})
