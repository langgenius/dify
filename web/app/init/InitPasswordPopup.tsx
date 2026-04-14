'use client'
import type { InitValidateStatusResponse } from '@/models/common'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/base/ui/button'
import { toast } from '@/app/components/base/ui/toast'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter } from '@/next/navigation'
import { fetchInitValidateStatus, initValidate } from '@/service/common'
import { basePath } from '@/utils/var'
import Loading from '../components/base/loading'

const InitPasswordPopup = () => {
  useDocumentTitle('')
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
      toast.error(e.message)
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInitValidateStatus().then((res: InitValidateStatusResponse) => {
      if (res.status === 'finished')
        window.location.href = `${basePath}/install`
      else
        setLoading(false)
    })
  }, [])

  return (
    loading
      ? <Loading />
      : (
          <div>
            {!validated && (
              <div className="mx-12 block min-w-28">
                <div className="mb-4">
                  <label htmlFor="password" className="block text-sm font-medium text-text-secondary">
                    {t('adminInitPassword', { ns: 'login' })}

                  </label>
                  <div className="relative mt-1 rounded-md shadow-sm">
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="block w-full appearance-none rounded-md border border-divider-regular px-3 py-2 shadow-sm placeholder:text-text-quaternary focus:border-indigo-500 focus:ring-indigo-500 focus:outline-hidden sm:text-sm"
                    />
                  </div>
                </div>
                <div className="flex flex-row flex-wrap justify-stretch p-0">
                  <Button variant="primary" onClick={handleValidation} className="min-w-28 basis-full">
                    {t('validate', { ns: 'login' })}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
  )
}

export default InitPasswordPopup
