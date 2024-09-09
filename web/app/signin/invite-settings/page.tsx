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
  const [timezone, setTimezone] = useState(timezones[0].value)

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
        localStorage.setItem('console_token', res.data)
        setLocaleOnClient(language, false)
        router.replace('/apps')
      }
    }
    catch {
      recheck()
    }
  }, [language, name, recheck, setLocaleOnClient, timezone, token, router])

  if (!checkRes)
    return <Loading />
  if (!checkRes.is_valid) {
    return <div className="flex flex-col md:w-[400px]">
      <div className="w-full mx-auto">
        <div className="mb-3 flex justify-center items-center w-20 h-20 p-5 rounded-[20px] border border-gray-100 shadow-lg text-[40px] font-bold">🤷‍♂️</div>
        <h2 className="text-[32px] font-bold text-gray-900">{t('login.invalid')}</h2>
      </div>
      <div className="w-full mx-auto mt-6">
        <Button variant='primary' className='w-full !text-sm'>
          <a href="https://dify.ai">{t('login.explore')}</a>
        </Button>
      </div>
    </div>
  }

  return <div className='flex flex-col gap-3'>
    <div className='bg-background-default-dodge text-text-accent-light-mode-only border-[0.5px] shadow inline-flex  w-14 h-14 justify-center items-center rounded-2xl text-2xl'>
      <RiAccountCircleLine />
    </div>
    <div className='pt-3 pb-4'>
      <h2 className='text-4xl font-semibold'>{t('login.setYourAccount')}</h2>
    </div>
    <form action=''>

      <div className='mb-5'>
        <label htmlFor="name" className="my-2 flex items-center justify-between text-sm font-medium text-gray-900">
          {t('login.name')}
        </label>
        <div className="mt-1 relative rounded-md shadow-sm">
          <Input
            id="name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('login.namePlaceholder') || ''}
            className={'appearance-none block w-full rounded-lg pl-[14px] px-3 py-2 border border-gray-200 hover:border-gray-300 hover:shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 placeholder-gray-400 caret-primary-600 sm:text-sm pr-10'}
          />
        </div>
      </div>
      <div className='mb-5'>
        <label htmlFor="name" className="my-2 flex items-center justify-between text-sm font-medium text-gray-900">
          {t('login.interfaceLanguage')}
        </label>
        <div className="relative mt-1 rounded-md shadow-sm">
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
        <label htmlFor="timezone" className="block text-sm font-medium text-gray-700">
          {t('login.timezone')}
        </label>
        <div className="relative mt-1 rounded-md shadow-sm">
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
          className='w-full !text-sm'
          onClick={handleActivate}
        >
          {`${t('login.join')} ${checkRes?.data.workspace_name}`}
        </Button>
      </div>
    </form>
    <div className="block w-hull mt-2 text-xs text-gray-600">
      {t('login.license.tip')}
      &nbsp;
      <Link
        className='text-primary-600'
        target='_blank' rel='noopener noreferrer'
        href={`https://docs.dify.ai/${language !== LanguagesSupported[1] ? 'user-agreement' : `v/${locale.toLowerCase()}/policies`}/open-source`}
      >{t('login.license.link')}</Link>
    </div>
  </div>
}
