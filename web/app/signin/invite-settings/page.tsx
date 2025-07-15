'use client'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useContext } from 'use-context-selector'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { RiAccountCircleLine } from '@remixicon/react'
import Input from '@/app/components/base/input'
import { SimpleSelect } from '@/app/components/base/select'
import Button from '@/app/components/base/button'
import { timezones } from '@/utils/timezone'
import { LanguagesSupported, languages } from '@/i18n/language'
import I18n from '@/context/i18n'
import { activateMember, invitationCheck } from '@/service/common'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import { noop } from 'lodash-es'

export default function InviteSettingsPage() {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = decodeURIComponent(searchParams.get('invite_token') as string)
  const { setLocaleOnClient } = useContext(I18n)
  const [name, setName] = useState('')
  const [language, setLanguage] = useState(LanguagesSupported[0])
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles')

  const checkParams = {
    url: '/activate/check',
    params: {
      token,
    },
  }
  const { data: checkRes, mutate: recheck } = useSWR(checkParams, invitationCheck, {
    revalidateOnFocus: false,
  })

  const handleActivate = useCallback(async () => {
    try {
      if (!name) {
        Toast.notify({ type: 'error', message: t('login.enterYourName') })
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
        localStorage.setItem('console_token', res.data.access_token)
        localStorage.setItem('refresh_token', res.data.refresh_token)
        setLocaleOnClient(language, false)
        router.replace('/apps')
      }
    }
    catch {
      recheck()
    }
  }, [language, name, recheck, setLocaleOnClient, timezone, token, router, t])

  if (!checkRes)
    return <Loading />
  if (!checkRes.is_valid) {
    return <div className="flex flex-col md:w-[400px]">
      <div className="mx-auto w-full">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle text-2xl font-bold shadow-lg">🤷‍♂️</div>
        <h2 className="title-4xl-semi-bold">{t('login.invalid')}</h2>
      </div>
      <div className="mx-auto mt-6 w-full">
        <Button variant='primary' className='w-full !text-sm'>
          <a href="https://dify.ai">{t('login.explore')}</a>
        </Button>
      </div>
    </div>
  }

  return <div className='flex flex-col gap-3'>
    <div className='inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge shadow-lg'>
      <RiAccountCircleLine className='h-6 w-6 text-2xl text-text-accent-light-mode-only' />
    </div>
    <div className='pb-4 pt-2'>
      <h2 className='title-4xl-semi-bold'>{t('login.setYourAccount')}</h2>
    </div>
    <form onSubmit={noop}>
      <div className='mb-5'>
        <label htmlFor="name" className="system-md-semibold my-2">
          {t('login.name')}
        </label>
        <div className="mt-1">
          <Input
            id="name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('login.namePlaceholder') || ''}
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
      <div className='mb-5'>
        <label htmlFor="name" className="system-md-semibold my-2">
          {t('login.interfaceLanguage')}
        </label>
        <div className="mt-1">
          <SimpleSelect
            defaultValue={LanguagesSupported[0]}
            items={languages.filter(item => item.supported)}
            onSelect={(item) => {
              setLanguage(item.value as string)
            }}
          />
        </div>
      </div>
      {/* timezone */}
      <div className='mb-5'>
        <label htmlFor="timezone" className="system-md-semibold">
          {t('login.timezone')}
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
          variant='primary'
          className='w-full'
          onClick={handleActivate}
        >
          {`${t('login.join')} ${checkRes?.data?.workspace_name}`}
        </Button>
      </div>
    </form>
    <div className="system-xs-regular mt-2 block w-full">
      {t('login.license.tip')}
      &nbsp;
      <Link
        className='system-xs-medium text-text-accent-secondary'
        target='_blank' rel='noopener noreferrer'
        href={docLink('/policies/open-source')}
      >{t('login.license.link')}</Link>
    </div>
  </div>
}
