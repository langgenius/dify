import { describe, expect, it } from 'vitest'
import { createReactI18nextMock, withSelectorKey, withSelectorKeyProps } from '../i18n-mock'

describe('createReactI18nextMock', () => {
  describe('Selector Keys', () => {
    it('should adapt an existing string-key translation mock', () => {
      // Arrange
      const legacyT = (key: string, prefix: string) => `${prefix}:${key}`
      const t = withSelectorKey(legacyT, 'app')

      // Act
      const result = t($ => $['accessControlDialog.title'], 'translated')

      // Assert
      expect(result).toBe('translated:accessControlDialog.title')
    })

    it('should adapt existing string-key Trans props', () => {
      // Arrange
      const LegacyTrans = ({ i18nKey }: { i18nKey: string }) => i18nKey
      const Trans = withSelectorKeyProps(LegacyTrans)

      // Act
      const result = Trans<'app'>({ i18nKey: $ => $['accessControlDialog.title'] })

      // Assert
      expect(result).toBe('accessControlDialog.title')
    })

    it('should preserve additional Trans props and optional i18n keys', () => {
      // Arrange
      const LegacyTrans = ({ components, i18nKey }: {
        components: { link: string }
        i18nKey?: string
      }) => `${i18nKey}:${components.link}`
      const Trans = withSelectorKeyProps(LegacyTrans)

      // Act
      const result = Trans<'app'>({
        components: { link: 'upgrade' },
        i18nKey: $ => $['accessControlDialog.title'],
      })

      // Assert
      expect(result).toBe('accessControlDialog.title:upgrade')
    })

    it('should preserve flat dotted keys selected with bracket notation', () => {
      // Arrange
      const { useTranslation } = createReactI18nextMock()
      const { t } = useTranslation('app')

      // Act
      const result = t($ => $['accessControlDialog.title'])

      // Assert
      expect(result).toBe('app.accessControlDialog.title')
    })

    it('should resolve selectors from secondary namespaces', () => {
      // Arrange
      const { useTranslation } = createReactI18nextMock()
      const { t } = useTranslation(['app', 'common'] as const)

      // Act
      const result = t($ => $.common['operation.close'])

      // Assert
      expect(result).toBe('common.operation.close')
    })

    it('should resolve selector keys passed to Trans', () => {
      // Arrange
      const { Trans } = createReactI18nextMock({
        'app.accessControlDialog.title': 'Access control',
      })

      // Act
      const element = Trans<'app'>({
        i18nKey: $ => $['accessControlDialog.title'],
        ns: 'app',
      })

      // Assert
      expect(element.props).toMatchObject({
        'data-i18n-key': 'app.accessControlDialog.title',
        'children': 'Access control',
      })
    })
  })
})
