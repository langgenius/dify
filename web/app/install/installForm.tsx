'use client'
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
// import { useContext } from 'use-context-selector'
import Toast from '../components/base/toast'
import Loading from '../components/base/loading'
import Button from '@/app/components/base/button'
// import I18n from '@/context/i18n'

import { fetchInitValidateStatus, fetchSetupStatus, setup } from '@/service/common'
import type { InitValidateStatusResponse, SetupStatusResponse } from '@/models/common'

const validEmailReg = /^[\w\.-]+@([\w-]+\.)+[\w-]{2,}$/
const validPassword = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/

const InstallForm = () => {
  const { t } = useTranslation()
  // const { locale } = useContext(I18n)
  // const language = getModelRuntimeSupported(locale)
  const router = useRouter()

  const [email, setEmail] = React.useState('')
  const [name, setName] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [loading, setLoading] = React.useState(true)

  const showErrorMessage = (message: string) => {
    Toast.notify({
      type: 'error',
      message,
    })
  }
  const valid = () => {
    if (!email) {
      showErrorMessage(t('login.error.emailEmpty'))
      return false
    }
    if (!validEmailReg.test(email)) {
      showErrorMessage(t('login.error.emailInValid'))
      return false
    }
    if (!name.trim()) {
      showErrorMessage(t('login.error.nameEmpty'))
      return false
    }
    if (!password.trim()) {
      showErrorMessage(t('login.error.passwordEmpty'))
      return false
    }
    if (!validPassword.test(password))
      showErrorMessage(t('login.error.passwordInvalid'))

    return true
  }
  const handleSetting = async () => {
    if (!valid())
      return
    await setup({
      body: {
        email,
        name,
        password,
      },
    })
    router.push('/signin')
  }

  useEffect(() => {
    fetchSetupStatus().then((res: SetupStatusResponse) => {
      if (res.step === 'finished') {
        window.location.href = '/signin'
      }
      else {
        fetchInitValidateStatus().then((res: InitValidateStatusResponse) => {
          if (res.status === 'not_started')
            window.location.href = '/init'
        })
      }
      setLoading(false)
    })
  }, [])

  return (
    loading
      ? <Loading />
      : <>
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h2 className="text-[32px] font-bold text-gray-900">{t('login.setAdminAccount')}</h2>
          <p className='
          mt-1 text-sm text-gray-600
        '>{t('login.setAdminAccountDesc')}</p>
        </div>

        <div className="grow mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white ">
            <form onSubmit={() => { }}>
              <div className='mb-5'>
                <label htmlFor="email" className="my-2 flex items-center justify-between text-sm font-medium text-gray-900">
                  {t('login.email')}
                </label>
                <div className="mt-1">
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={t('login.emailPlaceholder') || ''}
                    className={'appearance-none block w-full rounded-lg pl-[14px] px-3 py-2 border border-gray-200 hover:border-gray-300 hover:shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 placeholder-gray-400 caret-primary-600 sm:text-sm'}
                  />
                </div>
              </div>

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

              <div className='mb-5'>
                <label htmlFor="password" className="my-2 flex items-center justify-between text-sm font-medium text-gray-900">
                  {t('login.password')}
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={t('login.passwordPlaceholder') || ''}
                    className={'appearance-none block w-full rounded-lg pl-[14px] px-3 py-2 border border-gray-200 hover:border-gray-300 hover:shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 placeholder-gray-400 caret-primary-600 sm:text-sm pr-10'}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-gray-400 hover:text-gray-500 focus:outline-none focus:text-gray-500"
                    >
                      {showPassword ? '👀' : '😝'}
                    </button>
                  </div>
                </div>
                <div className='mt-1 text-xs text-gray-500'>{t('login.error.passwordInvalid')}</div>

              </div>

              {/* <div className="flex items-center justify-between">
              <div className="text-sm">
                <div className="flex items-center mb-4">
                  <input id="default-checkbox" type="checkbox" className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 rounded" />
                  <label htmlFor="default-checkbox" className="ml-2 text-sm font-medium cursor-pointer text-primary-600 hover:text-gray-500">{t('login.acceptPP')}</label>
                </div>
              </div>
            </div> */}
              <div>
                <Button type='primary' className='w-full !fone-medium !text-sm' onClick={handleSetting}>
                  {t('login.installBtn')}
                </Button>
              </div>
            </form>
            <div className="block w-hull mt-2 text-xs text-gray-600">
              {t('login.license.tip')}
              &nbsp;
              <Link
                className='text-primary-600'
                target='_blank' rel='noopener noreferrer'
                href={'https://docs.dify.ai/user-agreement/open-source'}
              >{t('login.license.link')}</Link>
            </div>
          </div>
        </div>
      </>
  )
}

export default InstallForm
