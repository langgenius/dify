'use client'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import Toast from '../components/base/toast'
import Loading from '../components/base/loading'
import Button from '@/app/components/base/button'
import { fetchInitValidateStatus, initValidate } from '@/service/common'
import type { InitValidateStatusResponse } from '@/models/common'

const InitPasswordPopup = () => {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [validated, setValidated] = useState(false)
  const router = useRouter()

  const { t } = useTranslation()

  const handleValidation = async () => {
    setLoading(true)
    try {
      const response = await initValidate({ body: { password } })
      if (response.result === 'success') {
        setValidated(true)
        router.push('/install') // or render setup form
      }
      else {
        throw new Error('Validation failed')
      }
    }
    catch (e: any) {
      Toast.notify({
        type: 'error',
        message: e.message,
        duration: 5000,
      })
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInitValidateStatus().then((res: InitValidateStatusResponse) => {
      if (res.status === 'finished')
        window.location.href = '/install'
      else
        setLoading(false)
    })
  }, [])

  return (
    loading
      ? <Loading />
      : <div>
        {!validated && (
          <div className="block mx-12 min-w-28">
            <div className="mb-4">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                {t('login.adminInitPassword')}

              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
            </div>
            <div className="flex flex-row flex-wrap justify-stretch p-0">
              <Button variant="primary" onClick={handleValidation} className="basis-full min-w-28">
                {t('login.validate')}
              </Button>
            </div>
          </div>
        )}
      </div>
  )
}

export default InitPasswordPopup
