import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import {
  createI18nextMock,
  createReactI18nextMock,
  withSelectorKey,
  withSelectorKeyProps,
} from '../i18n-mock'

describe('createReactI18nextMock', () => {
  describe('Selector Keys', () => {
    it('should adapt an existing string-key translation mock', () => {
      const legacyT = (key: string, prefix: string) => `${prefix}:${key}`
      const t = withSelectorKey(legacyT, 'app')

      const result = t(($) => $['accessControlDialog.title'], 'translated')

      expect(result).toBe('translated:accessControlDialog.title')
    })

    it('should adapt existing string-key Trans props', () => {
      const LegacyTrans = ({ i18nKey }: { i18nKey: string }) => i18nKey
      const Trans = withSelectorKeyProps(LegacyTrans)

      const result = Trans<'app'>({ i18nKey: ($) => $['accessControlDialog.title'] })

      expect(result).toBe('accessControlDialog.title')
    })

    it('should preserve additional Trans props and optional i18n keys', () => {
      const LegacyTrans = ({
        components,
        i18nKey,
      }: {
        components: { link: string }
        i18nKey?: string
      }) => `${i18nKey}:${components.link}`
      const Trans = withSelectorKeyProps(LegacyTrans)

      const result = Trans<'app'>({
        components: { link: 'upgrade' },
        i18nKey: ($) => $['accessControlDialog.title'],
      })

      expect(result).toBe('accessControlDialog.title:upgrade')
    })

    it('should preserve flat dotted keys selected with bracket notation', () => {
      const { useTranslation } = createReactI18nextMock()
      const { t } = useTranslation(['app'])

      const result = t(($) => $['accessControlDialog.title'])

      expect(result).toBe('app.accessControlDialog.title')
    })

    it('should preserve nested keys selected with property access', () => {
      const { useTranslation } = createReactI18nextMock()
      const { t } = useTranslation(['common'])

      const result = t(($) => $.operation!.close)

      expect(result).toBe('common.operation.close')
    })

    it('should resolve selectors from secondary namespaces', () => {
      const { useTranslation } = createReactI18nextMock()
      const { t } = useTranslation(['app', 'common'] as const)

      const result = t(($) => $.common!['operation.close'])

      expect(result).toBe('common.operation.close')
    })

    it('should resolve selector keys passed to Trans', () => {
      const { Trans } = createReactI18nextMock({
        'app.accessControlDialog.title': 'Access control',
      })

      const element = Trans<'app'>({
        i18nKey: ($) => $['accessControlDialog.title'],
        ns: 'app',
      })

      render(element)
      expect(screen.getByText('Access control')).toBeInTheDocument()
    })
  })

  describe('Shared Defaults', () => {
    it('should provide stable language and getI18n defaults', () => {
      const i18n = createReactI18nextMock()

      expect(i18n.useTranslation().i18n.language).toBe('en-US')
      expect(i18n.getI18n().t('operation.close', { ns: 'common' })).toBe('operation.close')
    })

    it('should create a standalone i18next mock without namespace formatting', () => {
      const i18n = createI18nextMock()

      expect(i18n.t(($) => $['operation.close'], { ns: 'common' })).toBe('operation.close')
    })
  })
})
