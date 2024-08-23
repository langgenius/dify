import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'
import { emailRegex } from '@/config'
import Toast from '@/app/components/base/toast'

export default function MailAndCodeAuth() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')

  const handleGetEMailVerificationCode = async () => {
    if (!emailRegex.test(email)) {
      Toast.notify({
        type: 'error',
        message: t('login.error.emailInValid'),
      })
    }
    window.location.href = '/signin/check-code'
  }

  return (<form onSubmit={() => { }}>
    <div className='mb-2'>
      <label htmlFor="email" className='my-2 block text-sm font-medium text-text-secondary'>{t('login.email')}</label>
      <div className='mt-1'>
        <Input type="email" value={email} placeholder={t('login.emailPlaceholder') as string} onChange={setEmail} className="px-3 h-9" />
      </div>
      <div className='mt-3'>
        <Button variant='primary' className='w-full' onClick={handleGetEMailVerificationCode}>{t('login.continueWithCode')}</Button>
      </div>
    </div>
  </form>
  )
}
