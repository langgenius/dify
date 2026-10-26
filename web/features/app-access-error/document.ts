import Negotiator from 'negotiator'
import { APP_UNAVAILABLE_PATH } from './document-constants'
import { getBrowserLocale } from './locale'

/** The proxy-owned error route skips application bootstrap and uses the visitor locale. */
export function getAppAccessErrorDocument(requestHeaders: Pick<Headers, 'get'>) {
  if (requestHeaders.get('x-dify-pathname') !== APP_UNAVAILABLE_PATH) return undefined
  return {
    locale: getBrowserLocale(
      new Negotiator({
        headers: { 'accept-language': requestHeaders.get('accept-language') ?? '' },
      }).languages(),
    ),
  }
}
