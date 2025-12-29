'use server'

import type { Locale } from './language'
import { cookies } from 'next/headers'
import { LOCALE_COOKIE_NAME } from '@/config'

export async function setUserLocaleServer(locale: Locale) {
  (await cookies()).set(
    LOCALE_COOKIE_NAME,
    locale,
    {
      // A year in milliseconds
      expires: 60 * 60 * 24 * 365 * 1000,
    },
  )
}
