'use client'
import { Button } from '@langgenius/dify-ui/button'
import {
  PasswordField,
  PasswordFieldInput,
  PasswordFieldToggle,
} from '@langgenius/dify-ui/password-field'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { toast } from '@/app/notifications'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter } from '@/next/navigation'
import { consoleClient } from '@/service/console'
import { basePath } from '@/utils/var'

const InitPasswordPopup = () => {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [validated, setValidated] = useState(false)
  const router = useRouter()

  const { t } = useTranslation(['login'])
  const pageTitle = t(($) => $.adminInitPassword, { ns: 'login' })
  useDocumentTitle(pageTitle)

  const handleValidation = async () => {
    setLoading(true)
    try {
      const response = await consoleClient.init.post(
        { body: { password } },
        { context: { silent: true } },
      )
      if (response.result === 'success') {
        setValidated(true)
        router.push('/install') // or render setup form
      } else {
        throw new Error('Validation failed')
      }
    } catch (e: any) {
      toast.error(e.message)
      setLoading(false)
    }
  }

  useEffect(() => {
    consoleClient.init.get().then((res) => {
      if (res.status === 'finished') window.location.href = `${basePath}/install`
      else setLoading(false)
    })
  }, [])

  return loading ? (
    <LoadingPlaceholder />
  ) : (
    <div>
      {!validated && (
        <div className="mx-12 block min-w-28">
          <div className="mb-4">
            <label htmlFor="password" className="block text-sm font-medium text-text-secondary">
              {pageTitle}
            </label>
            <PasswordField className="mt-1">
              <PasswordFieldInput
                id="password"
                autoComplete="current-password"
                value={password}
                onValueChange={setPassword}
              />
              <PasswordFieldToggle aria-label={t(($) => $.showPassword, { ns: 'login' })} />
            </PasswordField>
          </div>
          <div className="flex flex-row flex-wrap justify-stretch p-0">
            <Button variant="primary" onClick={handleValidation} className="min-w-28 basis-full">
              {t(($) => $.validate, { ns: 'login' })}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default InitPasswordPopup
