/**
 * Shared mock for react-i18next
 *
 * Jest automatically uses this mock when react-i18next is imported in tests.
 * The default behavior returns the translation key as-is, which is suitable
 * for most test scenarios.
 *
 * For tests that need custom translations, you can override with jest.mock():
 *
 * @example
 * jest.mock('react-i18next', () => ({
 *   useTranslation: () => ({
 *     t: (key: string) => {
 *       if (key === 'some.key') return 'Custom translation'
 *       return key
 *     },
 *   }),
 * }))
 */

export const useTranslation = () => ({
  t: (key: string, options?: Record<string, unknown>) => {
    if (options?.returnObjects)
      return [`${key}-feature-1`, `${key}-feature-2`]
    if (options)
      return `${key}:${JSON.stringify(options)}`
    return key
  },
  i18n: {
    language: 'en',
    changeLanguage: jest.fn(),
  },
})

export const Trans = ({ children }: { children?: React.ReactNode }) => children

export const initReactI18next = {
  type: '3rdParty',
  init: jest.fn(),
}
