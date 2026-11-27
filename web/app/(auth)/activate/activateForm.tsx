'use client'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'

const ActivateForm = () => {
  const router = useRouter()
  const { t } = useTranslation(['login', 'common'])
  const searchParams = useSearchParams()
  const workspaceID = searchParams.get('workspace_id')
  const email = searchParams.get('email')
  const token = searchParams.get('token')

  const checkParams = {
    url: '/activate/check',
    params: {
      ...(workspaceID && { workspace_id: workspaceID }),
      ...(email && { email }),
      token,
    },
  }
  const checkQuery = useQuery(
    consoleQuery.activate.check.get.queryOptions({
      input: token ? { query: { ...checkParams.params, token } } : skipToken,
      retry: false,
    }),
  )
  const checkRes = checkQuery.data
  const checkLoad = useOwnedQueryError(checkQuery)
  const checkErrorMessage = useRequestErrorMessage(
    checkLoad?.error,
    t(($) => $['api.actionFailed'], { ns: 'common' }),
  )
  useDocumentTitle(
    checkRes?.is_valid === false
      ? t(($) => $.invalid, { ns: 'login' })
      : t(($) => $.setYourAccount, { ns: 'login' }),
  )

  useEffect(() => {
    if (checkRes?.is_valid) {
      const params = new URLSearchParams(searchParams)
      params.set('email', encodeURIComponent(checkRes.data?.email ?? ''))
      params.set('workspace_id', encodeURIComponent(checkRes.data?.workspace_id ?? ''))
      params.set('invite_token', encodeURIComponent(token as string))
      router.replace(`/signin?${params.toString()}`)
    }
  }, [checkRes, router, searchParams, token])

  return (
    <>
      {!checkRes &&
        (checkErrorMessage ? (
          <Alert type="error">
            <AlertTitle>{checkErrorMessage}</AlertTitle>
            <AlertActions>
              <Button size="small" loading={checkLoad?.retrying} onClick={checkLoad?.retry}>
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </AlertActions>
          </Alert>
        ) : (
          <LoadingPlaceholder />
        ))}
      {checkRes && !checkRes.is_valid && (
        <div className="flex flex-col">
          <div className="mx-auto w-full">
            <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-[20px] border border-divider-regular bg-components-option-card-option-bg p-5 text-[40px] font-bold shadow-lg">
              🤷‍♂️
            </div>
            <h2 className="text-[32px] font-bold text-text-primary">
              {t(($) => $.invalid, { ns: 'login' })}
            </h2>
          </div>
          <div className="mx-auto mt-6 w-full">
            <a
              href="https://dify.ai"
              className={cn(buttonVariants({ variant: 'primary' }), 'w-full text-sm!')}
            >
              {t(($) => $.explore, { ns: 'login' })}
            </a>
          </div>
        </div>
      )}
    </>
  )
}

export default ActivateForm
