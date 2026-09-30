'use client'
import Cookies from 'js-cookie'
import { getI18n } from 'react-i18next'
import { LOCALE_COOKIE_NAME } from '@/config'
import { normalizeLocale } from './locale'

export const changeLanguage = async (lng?: string) => {
  if (!lng) return
  const i18n = getI18n()
  await i18n.changeLanguage(normalizeLocale(lng))
}

export const setLocaleOnClient = async (locale: string, reloadPage = true) => {
  const normalized = normalizeLocale(locale)
  Cookies.set(LOCALE_COOKIE_NAME, normalized, { expires: 365 })
  await changeLanguage(normalized)
  if (reloadPage) location.reload()
}
