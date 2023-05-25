'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Toast from '../components/base/toast'
import { setup } from '@/service/common'

const validEmailReg = /^[\w\.-]+@([\w-]+\.)+[\w-]{2,}$/
const validPassword = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/

const InstallForm = () => {
  const { t } = useTranslation()
  const router = useRouter()

  const [email, setEmail] = React.useState('')
  const [name, setName] = React.useState('')
  const [password, setPassword] = React.useState('')
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
    if (!validPassword.test(password)) {
      showErrorMessage(t('login.error.passwordInvalid'))
    }
    return true
  }
  const handleSetting = async () => {
    if (!valid()) return
    await setup({
      body: {
        email,
        name,
        password
      }
    })
    router.push('/signin')
  }
  return (
    <>
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="text-3xl font-normal text-gray-900">{t('login.setAdminAccount')}</h2>
        <p className='
          mt-2 text-sm text-gray-600
        '>{t('login.setAdminAccountDesc')}</p>
      </div>

      <div className="grow mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white ">
          <form className="space-y-6" onSubmit={() => { }}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                {t('login.email')}
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={'appearance-none block w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 rounded-md shadow-sm placeholder-gray-400 sm:text-sm'}
                />
              </div>
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                {t('login.name')}
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className={'appearance-none block w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 rounded-md shadow-sm placeholder-gray-400 sm:text-sm pr-10'}
                />

              </div>
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                {t('login.password')}
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <input
                  id="password"
                  type='password'
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={'appearance-none block w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 rounded-md shadow-sm placeholder-gray-400 sm:text-sm pr-10'}
                />
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
            {/*  agree to our Terms and Privacy Policy. */}
            <div className="block mt-6 text-xs text-gray-600">
              {t('login.tosDesc')}
              &nbsp;
              <Link
                className='text-primary-600'
                target={'_blank'}
                href='https://docs.dify.ai/user-agreement/terms-of-service'
              >{t('login.tos')}</Link>
              &nbsp;&&nbsp;
              <Link
                className='text-primary-600'
                target={'_blank'}
                href='https://langgenius.ai/privacy-policy'
              >{t('login.pp')}</Link>
            </div>

            <div>
              <Button type='primary' onClick={handleSetting}>
                {t('login.installBtn')}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

export default InstallForm
