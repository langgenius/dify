'use client'
import cn from 'classnames'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { getOIDCSSOUrl, getSAMLSSOUrl } from '@/service/enterprise'
import Button from '@/app/components/base/button'

type EnterpriseSSOFormProps = {
  protocol: string
}

const EnterpriseSSOForm: FC<EnterpriseSSOFormProps> = ({
  protocol,
}) => {
  const searchParams = useSearchParams()
  const consoleToken = searchParams.get('console_token')
  const message = searchParams.get('message')

  const router = useRouter()
  const { t } = useTranslation()

  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (consoleToken) {
      localStorage.setItem('console_token', consoleToken)
      router.replace('/apps')
    }

    if (message) {
      Toast.notify({
        type: 'error',
        message,
      })
    }
  }, [])

  const handleSSOLogin = () => {
    setIsLoading(true)
    if (protocol === 'saml') {
      getSAMLSSOUrl().then((res) => {
        router.push(res.url)
      }).finally(() => {
        setIsLoading(false)
      })
    }
    else {
      getOIDCSSOUrl().then((res) => {
        document.cookie = `oidc-state=${res.state}`
        router.push(res.url)
      }).finally(() => {
        setIsLoading(false)
      })
    }
  }

  return (
    <div className={
      cn(
        'flex flex-col items-center w-full grow items-center justify-center',
        'px-6',
        'md:px-[108px]',
      )
    }>
      <div className='flex flex-col md:w-[400px]'>
        <div className="w-full mx-auto">
          <h2 className="text-[32px] font-bold text-gray-900">{t('login.pageTitle')}</h2>
        </div>
        <div className="w-full mx-auto mt-10">
          <Button
            tabIndex={0}
            type='primary'
            onClick={() => { handleSSOLogin() }}
            disabled={isLoading}
            className="w-full !fone-medium !text-sm"
          >{t('login.sso')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default EnterpriseSSOForm
