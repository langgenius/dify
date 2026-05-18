'use client'
import type { Locale } from '@/i18n-config'
import { Button } from '@langgenius/dify-ui/button'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { toast } from '@langgenius/dify-ui/toast'
import { RiAccountCircleLine } from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { noop } from 'es-toolkit/function'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import Loading from '@/app/components/base/loading'
import { LICENSE_LINK } from '@/constants/link'
import { useLocale } from '@/context/i18n'
import { i18n, setLocaleOnClient } from '@/i18n-config'
import { languages } from '@/i18n-config/language'
import Link from '@/next/link'
import { useRouter, useSearchParams } from '@/next/navigation'
import { activateMember } from '@/service/common'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useInvitationCheck } from '@/service/use-common'
import { getBrowserTimezone, timezones } from '@/utils/timezone'
import { resolvePostLoginRedirect } from '../utils/post-login-redirect'

type LanguageSelectOption = {
  value: Locale
  name: string
}

type TimezoneSelectOption = {
  value: string
  name: string
}

const LANGUAGE_OPTIONS: LanguageSelectOption[] = languages
  .filter(item => item.supported)
  .map(item => ({
    value: item.value,
    name: item.name,
  }))

const TIMEZONE_OPTIONS: TimezoneSelectOption[] = timezones.map(item => ({
  value: String(item.value),
  name: item.name,
}))

const getInitialLanguage = (locale: Locale): Locale => {
  if (LANGUAGE_OPTIONS.some(item => item.value === locale))
    return locale

  return i18n.defaultLocale
}

export default function InviteSettingsPage() {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = decodeURIComponent(searchParams.get('invite_token') as string)
  const locale = useLocale()
  const [name, setName] = useState('')
  const [language, setLanguage] = useState(() => getInitialLanguage(locale))
  const [timezone, setTimezone] = useState(() => getBrowserTimezone() || 'America/Los_Angeles')
  const selectedLanguage = LANGUAGE_OPTIONS.find(item => item.value === language)
  const selectedTimezone = TIMEZONE_OPTIONS.find(item => item.value === timezone)

  const handleLanguageChange = (nextValue: string | null) => {
    const nextLanguage = LANGUAGE_OPTIONS.find(item => item.value === nextValue)
    if (nextLanguage)
      setLanguage(nextLanguage.value)
  }

  const handleTimezoneChange = (nextValue: string | null) => {
    const nextTimezone = TIMEZONE_OPTIONS.find(item => item.value === nextValue)
    if (nextTimezone)
      setTimezone(nextTimezone.value)
  }

  const checkParams = {
    url: '/activate/check',
    params: {
      token,
    },
  }
  const { data: checkRes, refetch: recheck } = useInvitationCheck(checkParams.params, !!token)

  const handleActivate = useCallback(async () => {
    try {
      if (!name) {
        toast.error(t('enterYourName', { ns: 'login' }))
        return
      }
      const res = await activateMember({
        url: '/activate',
        body: {
          token,
          name,
          interface_language: language,
          timezone,
        },
      })
      if (res.result === 'success') {
        // Tokens are now stored in cookies by the backend
        await setLocaleOnClient(language!, false)
        const redirectUrl = resolvePostLoginRedirect(searchParams)
        router.replace(redirectUrl || '/apps')
      }
    }
    catch {
      recheck()
    }
  }, [language, name, recheck, timezone, token, router, t])

  if (!checkRes)
    return <Loading />
  if (!checkRes.is_valid) {
    return (
      <div className="flex flex-col md:w-[400px]">
        <div className="mx-auto w-full">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle text-2xl font-bold shadow-lg">🤷‍♂️</div>
          <h2 className="title-4xl-semi-bold text-text-primary">{t('invalid', { ns: 'login' })}</h2>
        </div>
        <div className="mx-auto mt-6 w-full">
          <Button variant="primary" className="w-full text-sm!">
            <a href="https://dify.ai">{t('explore', { ns: 'login' })}</a>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge shadow-lg">
        <RiAccountCircleLine className="h-6 w-6 text-2xl text-text-accent-light-mode-only" />
      </div>
      <div className="pt-2 pb-4">
        <h2 className="title-4xl-semi-bold text-text-primary">{t('setYourAccount', { ns: 'login' })}</h2>
      </div>
      <form onSubmit={noop}>
        <div className="mb-5">
          <label htmlFor="name" className="my-2 system-md-semibold text-text-secondary">
            {t('name', { ns: 'login' })}
          </label>
          <div className="mt-1">
            <Input
              id="name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('namePlaceholder', { ns: 'login' }) || ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  handleActivate()
                }
              }}
            />
          </div>
        </div>
        <div className="mb-5">
          <label htmlFor="interface_language" className="my-2 system-md-semibold text-text-secondary">
            {t('interfaceLanguage', { ns: 'login' })}
          </label>
          <div className="mt-1">
            <Select
              value={selectedLanguage?.value ?? null}
              onValueChange={handleLanguageChange}
            >
              <SelectTrigger id="interface_language" size="large">
                {selectedLanguage?.name ?? t('placeholder.select', { ns: 'common' })}
              </SelectTrigger>
              <SelectContent>
                {LANGUAGE_OPTIONS.map(item => (
                  <SelectItem key={item.value} value={item.value}>
                    <SelectItemText>{item.name}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {/* timezone */}
        <div className="mb-5">
          <label htmlFor="timezone" className="system-md-semibold text-text-secondary">
            {t('timezone', { ns: 'login' })}
          </label>
          <div className="mt-1">
            <Select
              value={selectedTimezone?.value ?? null}
              onValueChange={handleTimezoneChange}
            >
              <SelectTrigger id="timezone" size="large">
                {selectedTimezone?.name ?? t('placeholder.select', { ns: 'common' })}
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map(item => (
                  <SelectItem key={item.value} value={item.value}>
                    <SelectItemText>{item.name}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Button
            variant="primary"
            className="w-full"
            onClick={handleActivate}
          >
            {`${t('join', { ns: 'login' })} ${checkRes?.data?.workspace_name}`}
          </Button>
        </div>
      </form>
      {!systemFeatures.branding.enabled && (
        <div className="mt-2 block w-full system-xs-regular text-text-tertiary">
          {t('license.tip', { ns: 'login' })}
      &nbsp;
          <Link
            className="system-xs-medium text-text-accent-secondary"
            target="_blank"
            rel="noopener noreferrer"
            href={LICENSE_LINK}
          >
            {t('license.link', { ns: 'login' })}
          </Link>
        </div>
      )}
    </div>
  )
}
