'use client'
import type { Locale } from '@/i18n-config'
import { RiAccountCircleLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Loading from '@/app/components/base/loading'
import { SimpleSelect } from '@/app/components/base/select'
import Toast from '@/app/components/base/toast'
import { LICENSE_LINK } from '@/constants/link'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { setLocaleOnClient } from '@/i18n-config'
import { languages, LanguagesSupported } from '@/i18n-config/language'
import { activateMember } from '@/service/common'
import { useInvitationCheck } from '@/service/use-common'
import { timezones } from '@/utils/timezone'
import { resolvePostLoginRedirect } from '../utils/post-login-redirect'

export default function InviteSettingsPage() {
  const { t } = useTranslation()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = decodeURIComponent(searchParams.get('invite_token') as string)
  const [name, setName] = useState('')
  const [language, setLanguage] = useState(LanguagesSupported[0])
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles')

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
        Toast.notify({ type: 'error', message: t('enterYourName', { ns: 'login' }) })
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
        await setLocaleOnClient(language, false)
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
          <Button variant="primary" className="w-full !text-sm">
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
      <div className="pb-4 pt-2">
        <h2 className="title-4xl-semi-bold text-text-primary">{t('setYourAccount', { ns: 'login' })}</h2>
      </div>
      <form onSubmit={noop}>
        <div className="mb-5">
          <label htmlFor="name" className="system-md-semibold my-2 text-text-secondary">
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
          <label htmlFor="name" className="system-md-semibold my-2 text-text-secondary">
            {t('interfaceLanguage', { ns: 'login' })}
          </label>
          <div className="mt-1">
            <SimpleSelect
              defaultValue={LanguagesSupported[0]}
              items={languages.filter(item => item.supported)}
              onSelect={(item) => {
                setLanguage(item.value as Locale)
              }}
            />
          </div>
        </div>
        {/* timezone */}
        <div className="mb-5">
          <label htmlFor="timezone" className="system-md-semibold text-text-secondary">
            {t('timezone', { ns: 'login' })}
          </label>
          <div className="mt-1">
            <SimpleSelect
              defaultValue={timezone}
              items={timezones}
              onSelect={(item) => {
                setTimezone(item.value as string)
              }}
            />
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
        <div className="system-xs-regular mt-2 block w-full text-text-tertiary">
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
