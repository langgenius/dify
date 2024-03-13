'use client'
import { useCallback, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { useSearchParams } from 'next/navigation'
import cn from 'classnames'
import Link from 'next/link'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import style from './style.module.css'
import Button from '@/app/components/base/button'

import { SimpleSelect } from '@/app/components/base/select'
import { timezones } from '@/utils/timezone'
import { LanguagesSupported, languages } from '@/i18n/language'
import { activateMember, invitationCheck } from '@/service/common'
import Toast from '@/app/components/base/toast'
import Loading from '@/app/components/base/loading'
import I18n from '@/context/i18n'
const validPassword = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/

const ActivateForm = () => {
  const { t } = useTranslation()
  const { locale, setLocaleOnClient } = useContext(I18n)
  const searchParams = useSearchParams()
  const workspaceID = searchParams.get('workspace_id')
  const email = searchParams.get('email')
  const token = searchParams.get('token')

  const checkParams = {
    url: '/activate/check',
    params: {
      ...workspaceID && { workspace_id: workspaceID },
      ...email && { email },
      token,
    },
  }
  const { data: checkRes, mutate: recheck } = useSWR(checkParams, invitationCheck, {
    revalidateOnFocus: false,
  })

  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [timezone, setTimezone] = useState('Asia/Shanghai')
  const [language, setLanguage] = useState(locale)
  const [showSuccess, setShowSuccess] = useState(false)
  const defaultLanguage = useCallback(() => (window.navigator.language.startsWith('zh') ? LanguagesSupported[1] : LanguagesSupported[0]) || LanguagesSupported[0], [])

  const showErrorMessage = useCallback((message: string) => {
    Toast.notify({
      type: 'error',
      message,
    })
  }, [])

  const valid = useCallback(() => {
    if (!name.trim()) {
      showErrorMessage(t('login.error.nameEmpty'))
      return false
    }
    if (!password.trim()) {
      showErrorMessage(t('login.error.passwordEmpty'))
      return false
    }
    if (!validPassword.test(password)) {
      showErrorMessage(t('login.error.passwordInvalid'))
      return false
    }

    return true
  }, [name, password, showErrorMessage, t])

  const handleActivate = useCallback(async () => {
    if (!valid())
      return
    try {
      await activateMember({
        url: '/activate',
        body: {
          workspace_id: workspaceID,
          email,
          token,
          name,
          password,
          interface_language: language,
          timezone,
        },
      })
      setLocaleOnClient(language.startsWith('en') ? 'en' : 'zh-Hans', false)
      setShowSuccess(true)
    }
    catch {
      recheck()
    }
  }, [email, language, name, password, recheck, setLocaleOnClient, timezone, token, valid, workspaceID])

  return (
    <div className={
      cn(
        'flex flex-col items-center w-full grow justify-center',
        'px-6',
        'md:px-[108px]',
      )
    }>
      {!checkRes && <Loading />}
      {checkRes && !checkRes.is_valid && (
        <div className="flex flex-col md:w-[400px]">
          <div className="w-full mx-auto">
            <div className="mb-3 flex justify-center items-center w-20 h-20 p-5 rounded-[20px] border border-gray-100 shadow-lg text-[40px] font-bold">🤷‍♂️</div>
            <h2 className="text-[32px] font-bold text-gray-900">{t('login.invalid')}</h2>
          </div>
          <div className="w-full mx-auto mt-6">
            <Button type='primary' className='w-full !fone-medium !text-sm'>
              <a href="https://dify.ai">{t('login.explore')}</a>
            </Button>
          </div>
        </div>
      )}
      {checkRes && checkRes.is_valid && !showSuccess && (
        <div className='flex flex-col md:w-[400px]'>
          <div className="w-full mx-auto">
            <div className={`mb-3 flex justify-center items-center w-20 h-20 p-5 rounded-[20px] border border-gray-100 shadow-lg text-[40px] font-bold ${style.logo}`}>
            </div>
            <h2 className="text-[32px] font-bold text-gray-900">
              {`${t('login.join')} ${checkRes.workspace_name}`}
            </h2>
            <p className='mt-1 text-sm text-gray-600 '>
              {`${t('login.joinTipStart')} ${checkRes.workspace_name} ${t('login.joinTipEnd')}`}
            </p>
          </div>

          <div className="w-full mx-auto mt-6">
            <div className="bg-white">
              {/* username */}
              <div className='mb-5'>
                <label htmlFor="name" className="my-2 flex items-center justify-between text-sm font-medium text-gray-900">
                  {t('login.name')}
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={t('login.namePlaceholder') || ''}
                    className={'appearance-none block w-full rounded-lg pl-[14px] px-3 py-2 border border-gray-200 hover:border-gray-300 hover:shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 placeholder-gray-400 caret-primary-600 sm:text-sm pr-10'}
                  />
                </div>
              </div>
              {/* password */}
              <div className='mb-5'>
                <label htmlFor="password" className="my-2 flex items-center justify-between text-sm font-medium text-gray-900">
                  {t('login.password')}
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <input
                    id="password"
                    type='password'
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={t('login.passwordPlaceholder') || ''}
                    className={'appearance-none block w-full rounded-lg pl-[14px] px-3 py-2 border border-gray-200 hover:border-gray-300 hover:shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 placeholder-gray-400 caret-primary-600 sm:text-sm pr-10'}
                  />
                </div>
                <div className='mt-1 text-xs text-gray-500'>{t('login.error.passwordInvalid')}</div>
              </div>
              {/* language */}
              <div className='mb-5'>
                <label htmlFor="name" className="my-2 flex items-center justify-between text-sm font-medium text-gray-900">
                  {t('login.interfaceLanguage')}
                </label>
                <div className="relative mt-1 rounded-md shadow-sm">
                  <SimpleSelect
                    defaultValue={defaultLanguage()}
                    items={languages}
                    onSelect={(item) => {
                      setLanguage(item.value as string)
                    }}
                  />
                </div>
              </div>
              {/* timezone */}
              <div className='mb-4'>
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
                  type='primary'
                  className='w-full !fone-medium !text-sm'
                  onClick={handleActivate}
                >
                  {`${t('login.join')} ${checkRes.workspace_name}`}
                </Button>
              </div>
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
          </div>
        </div>
      )}
      {checkRes && checkRes.is_valid && showSuccess && (
        <div className="flex flex-col md:w-[400px]">
          <div className="w-full mx-auto">
            <div className="mb-3 flex justify-center items-center w-20 h-20 p-5 rounded-[20px] border border-gray-100 shadow-lg text-[40px] font-bold">
              <CheckCircleIcon className='w-10 h-10 text-[#039855]' />
            </div>
            <h2 className="text-[32px] font-bold text-gray-900">
              {`${t('login.activatedTipStart')} ${checkRes.workspace_name} ${t('login.activatedTipEnd')}`}
            </h2>
          </div>
          <div className="w-full mx-auto mt-6">
            <Button type='primary' className='w-full !fone-medium !text-sm'>
              <a href="/signin">{t('login.activated')}</a>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ActivateForm
