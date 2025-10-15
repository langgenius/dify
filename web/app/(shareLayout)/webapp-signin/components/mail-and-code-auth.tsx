import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter, useSearchParams } from 'next/navigation'
import { useContext } from 'use-context-selector'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'
import { emailRegex } from '@/config'
import Toast from '@/app/components/base/toast'
import { sendWebAppEMailLoginCode } from '@/service/common'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '@/app/components/signin/countdown'
import I18NContext from '@/context/i18n'
import { noop } from 'lodash-es'

export default function MailAndCodeAuth() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const emailFromLink = decodeURIComponent(searchParams.get('email') || '')
  const [email, setEmail] = useState(emailFromLink)
  const [loading, setIsLoading] = useState(false)
  const { locale } = useContext(I18NContext)

  const handleGetEMailVerificationCode = async () => {
    try {
      if (!email) {
        Toast.notify({ type: 'error', message: t('login.error.emailEmpty') })
        return
      }

      if (!emailRegex.test(email)) {
        Toast.notify({
          type: 'error',
          message: t('login.error.emailInValid'),
        })
        return
      }
      setIsLoading(true)
      const ret = await sendWebAppEMailLoginCode(email, locale)
      if (ret.result === 'success') {
        localStorage.setItem(COUNT_DOWN_KEY, `${COUNT_DOWN_TIME_MS}`)
        const params = new URLSearchParams(searchParams)
        params.set('email', encodeURIComponent(email))
        params.set('token', encodeURIComponent(ret.data))
        router.push(`/webapp-signin/check-code?${params.toString()}`)
      }
    }
    catch (error) {
      console.error(error)
    }
    finally {
      setIsLoading(false)
    }
  }

  return (<form onSubmit={noop}>
    <input type='text' className='hidden' />
    <div className='mb-2'>
      <label htmlFor="email" className='system-md-semibold my-2 text-text-secondary'>{t('login.email')}</label>
      <div className='mt-1'>
        <Input id='email' type="email" value={email} placeholder={t('login.emailPlaceholder') as string} onChange={e => setEmail(e.target.value)} />
      </div>
      <div className='mt-3'>
        <Button loading={loading} disabled={loading || !email} variant='primary' className='w-full' onClick={handleGetEMailVerificationCode}>{t('login.signup.verifyMail')}</Button>
      </div>
    </div>
  </form>
  )
}
