'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useMutation } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { useSearchParams } from '@/next/navigation'
import {
  cancelWebAppAccountLogin,
  completeWebAppAccountLogin,
  resolveWebAppAccountReturn,
} from '@/service/webapp/login'
import { basePath } from '@/utils/var'

export default function EndUserLogin() {
  const { t } = useTranslation(['common', 'share'])
  const params = useSearchParams()
  const redirect = params.get('redirect_url')
  const code = params.get('login_code')
  const { mutate, isError } = useMutation({
    mutationFn: () => completeWebAppAccountLogin(redirect, code || ''),
    onSuccess: (target) => window.location.replace(target),
  })
  useEffect(() => {
    mutate()
  }, [mutate])
  if (!isError) return <LoadingPlaceholder />
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <p role="alert">{t(($) => $['api.actionFailed'], { ns: 'common' })}</p>
      <Button
        onClick={() => {
          const target = resolveWebAppAccountReturn(redirect)
          cancelWebAppAccountLogin(redirect)
          window.location.replace(target?.url || `${basePath}/`)
        }}
      >
        {t(($) => $['login.backToHome'], { ns: 'share' })}
      </Button>
    </main>
  )
}
