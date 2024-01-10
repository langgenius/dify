import { match } from '@formatjs/intl-localematcher'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { Locale } from './i18n'
import { i18n } from './i18n'

export const getLocale = (request: NextRequest): Locale => {
  // @ts-expect-error locales are readonly
  const locales: Locale[] = i18n.locales

  const localeCookie = request.cookies.get('locale')
  const languages = localeCookie?.value ? [localeCookie.value] : []

  const negotiatorHeaders: Record<string, string> = {}
  request.headers.forEach((value, key) => (negotiatorHeaders[key] = value))
  const matchedLocale = match(languages, locales, i18n.defaultLocale) as Locale

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
