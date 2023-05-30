import { match } from '@formatjs/intl-localematcher'
import Negotiator from 'negotiator'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { Locale } from './i18n'
import { i18n } from './i18n'

export const getLocale = (request: NextRequest): Locale => {
  // @ts-expect-error locales are readonly
  const locales: Locale[] = i18n.locales

  let languages: string[] | undefined
  // get locale from cookie
  const localeCookie = request.cookies.get('locale')
  languages = localeCookie?.value ? [localeCookie.value] : []

  if (!languages.length) {
    // Negotiator expects plain object so we need to transform headers
    const negotiatorHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => (negotiatorHeaders[key] = value))
    // Use negotiator and intl-localematcher to get best locale
    languages = new Negotiator({ headers: negotiatorHeaders }).languages()
  }

  // match locale
  let matchedLocale: Locale = i18n.defaultLocale
  try {
    // If languages is ['*'], Error would happen in match function.
    matchedLocale = match(languages, locales, i18n.defaultLocale) as Locale
  }
  catch (e) {}
  return matchedLocale
}

export const middleware = async (request: NextRequest) => {
  const pathname = request.nextUrl.pathname
  if (/\.(css|js(on)?|ico|svg|png)$/.test(pathname))
    return

  const locale = getLocale(request)
  const response = NextResponse.next()
  response.cookies.set('locale', locale)
  return response
}
