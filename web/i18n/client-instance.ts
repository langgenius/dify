import type { i18n as I18n } from 'i18next'

let clientI18n: I18n | undefined

/**
 * The browser's i18n instance, for the request layer. That layer is also loaded on the server
 * (RSC), where react-i18next cannot be imported, so it cannot call `getI18n()` itself.
 * `I18nClientProvider` registers the instance in the browser; on the server this is `undefined`.
 */
export function getClientI18n(): I18n | undefined {
  return clientI18n
}

export function setClientI18n(instance: I18n) {
  clientI18n = instance
}
