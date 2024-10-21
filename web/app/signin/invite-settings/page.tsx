'use client'
import { useTranslation } from 'react-i18next'
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

export default function InviteSettingsPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = decodeURIComponent(searchParams.get('invite_token') as string)
  const { locale, setLocaleOnClient } = useContext(I18n)
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
      <div className="w-full mx-auto">
        <div className="mb-3 flex justify-center items-center w-14 h-14 rounded-2xl border border-components-panel-border-subtle shadow-lg text-2xl font-bold">🤷‍♂️</div>
        <h2 className="title-4xl-semi-bold">{t('login.invalid')}</h2>
      </div>
      <div className="w-full mx-auto mt-6">
        <Button variant='primary' className='w-full !text-sm'>
          <a href="https://dify.ai">{t('login.explore')}</a>
        </Button>
      </div>
    </div>
  }

  return <div className='flex flex-col gap-3'>
    <div className='bg-background-default-dodge border border-components-panel-border-subtle shadow-lg inline-flex w-14 h-14 justify-center items-center rounded-2xl'>
      <RiAccountCircleLine className='w-6 h-6 text-2xl text-text-accent-light-mode-only' />
    </div>
    <div className='pt-2 pb-4'>
      <h2 className='title-4xl-semi-bold'>{t('login.setYourAccount')}</h2>
    </div>
    <form action=''>

      <div className='mb-5'>
        <label htmlFor="name" className="my-2 system-md-semibold">
          {t('login.name')}
        </label>
        <div className="mt-1">
          <Input
            id="name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('login.namePlaceholder') || ''}
          />
        </div>
      </div>
      <div className='mb-5'>
        <label htmlFor="name" className="my-2 system-md-semibold">
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
    <div className="block w-full mt-2 system-xs-regular">
      {t('login.license.tip')}
      &nbsp;
      <Link
        className='system-xs-medium text-text-accent-secondary'
        target='_blank' rel='noopener noreferrer'
        href={`https://docs.dify.ai/${language !== LanguagesSupported[1] ? 'user-agreement' : `v/${locale.toLowerCase()}/policies`}/open-source`}
      >{t('login.license.link')}</Link>
    </div>
  </div>
}
