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
  const filePath = path.join(I18N_DIR, locale, 'app-debug.ts')

  if (!fs.existsSync(filePath))
    throw new Error(`Translation file not found: ${filePath}`)

  return fs.readFileSync(filePath, 'utf-8')
}

// Helper function to check if upload features exist
const hasUploadFeatures = (content: string): { [key: string]: boolean } => {
  return {
    fileUpload: /fileUpload\s*:\s*{/.test(content),
    imageUpload: /imageUpload\s*:\s*{/.test(content),
    documentUpload: /documentUpload\s*:\s*{/.test(content),
    audioUpload: /audioUpload\s*:\s*{/.test(content),
    featureBar: /bar\s*:\s*{/.test(content),
  }
}

describe('Upload Features i18n Translations - Issue #23062', () => {
  let supportedLocales: string[]

  beforeAll(() => {
    supportedLocales = getSupportedLocales()
    console.log(`Testing ${supportedLocales.length} locales for upload features`)
  })

  test('all locales should have translation files', () => {
    supportedLocales.forEach((locale) => {
      const filePath = path.join(I18N_DIR, locale, 'app-debug.ts')
      expect(fs.existsSync(filePath)).toBe(true)
    })
  })

  test('all locales should have required upload features', () => {
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

  test('previously missing locales should now have audioUpload - Issue #23062', () => {
    // These locales were specifically missing audioUpload
    const previouslyMissingLocales = ['fa-IR', 'hi-IN', 'ro-RO', 'sl-SI', 'th-TH', 'uk-UA', 'vi-VN']

    previouslyMissingLocales.forEach((locale) => {
      const content = loadTranslationContent(locale)

      // Verify audioUpload exists
      expect(/audioUpload\s*:\s*{/.test(content)).toBe(true)

      // Verify it has title and description
      expect(/audioUpload[^}]*title\s*:/.test(content)).toBe(true)
      expect(/audioUpload[^}]*description\s*:/.test(content)).toBe(true)

      console.log(`✅ ${locale} - Issue #23062 resolved: audioUpload feature present`)
    })
  })

  test('upload features should have required properties', () => {
    supportedLocales.forEach((locale) => {
      const content = loadTranslationContent(locale)

      // Check fileUpload has required properties
      if (/fileUpload\s*:\s*{/.test(content)) {
        expect(/fileUpload[^}]*title\s*:/.test(content)).toBe(true)
        expect(/fileUpload[^}]*description\s*:/.test(content)).toBe(true)
      }

      // Check imageUpload has required properties
      if (/imageUpload\s*:\s*{/.test(content)) {
        expect(/imageUpload[^}]*title\s*:/.test(content)).toBe(true)
        expect(/imageUpload[^}]*description\s*:/.test(content)).toBe(true)
      }

      // Check documentUpload has required properties
      if (/documentUpload\s*:\s*{/.test(content)) {
        expect(/documentUpload[^}]*title\s*:/.test(content)).toBe(true)
        expect(/documentUpload[^}]*description\s*:/.test(content)).toBe(true)
      }

      // Check audioUpload has required properties
      if (/audioUpload\s*:\s*{/.test(content)) {
        expect(/audioUpload[^}]*title\s*:/.test(content)).toBe(true)
        expect(/audioUpload[^}]*description\s*:/.test(content)).toBe(true)
      }
    })
  })
})
