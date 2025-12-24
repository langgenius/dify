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
const loadTranslationContent = (locale: string): Record<string, unknown> => {
  const filePath = path.join(I18N_DIR, locale, 'app-debug.json')

  if (!fs.existsSync(filePath))
    throw new Error(`Translation file not found: ${filePath}`)

  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

// Helper function to check if upload features exist
const hasUploadFeatures = (content: Record<string, unknown>): { [key: string]: boolean } => {
  const feature = content.feature as Record<string, unknown> | undefined
  return {
    fileUpload: !!(feature?.fileUpload && typeof feature.fileUpload === 'object'),
    imageUpload: !!(feature?.imageUpload && typeof feature.imageUpload === 'object'),
    documentUpload: !!(feature?.documentUpload && typeof feature.documentUpload === 'object'),
    audioUpload: !!(feature?.audioUpload && typeof feature.audioUpload === 'object'),
    featureBar: !!(feature?.bar && typeof feature.bar === 'object'),
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
      const feature = content.feature as Record<string, unknown> | undefined
      const audioUpload = feature?.audioUpload as Record<string, unknown> | undefined

      // Verify audioUpload exists
      expect(audioUpload && typeof audioUpload === 'object').toBe(true)

      // Verify it has title and description
      expect(audioUpload?.title).toBeDefined()
      expect(audioUpload?.description).toBeDefined()

      console.log(`✅ ${locale} - Issue #23062 resolved: audioUpload feature present`)
    })
  })

  it('upload features should have required properties', () => {
    supportedLocales.forEach((locale) => {
      const content = loadTranslationContent(locale)
      const feature = content.feature as Record<string, unknown> | undefined

      // Check fileUpload has required properties
      const fileUpload = feature?.fileUpload as Record<string, unknown> | undefined
      if (fileUpload && typeof fileUpload === 'object') {
        expect(fileUpload.title).toBeDefined()
        expect(fileUpload.description).toBeDefined()
      }

      // Check imageUpload has required properties
      const imageUpload = feature?.imageUpload as Record<string, unknown> | undefined
      if (imageUpload && typeof imageUpload === 'object') {
        expect(imageUpload.title).toBeDefined()
        expect(imageUpload.description).toBeDefined()
      }

      // Check documentUpload has required properties
      const documentUpload = feature?.documentUpload as Record<string, unknown> | undefined
      if (documentUpload && typeof documentUpload === 'object') {
        expect(documentUpload.title).toBeDefined()
        expect(documentUpload.description).toBeDefined()
      }

      // Check audioUpload has required properties
      const audioUpload = feature?.audioUpload as Record<string, unknown> | undefined
      if (audioUpload && typeof audioUpload === 'object') {
        expect(audioUpload.title).toBeDefined()
        expect(audioUpload.description).toBeDefined()
      }
    })
  })
})
