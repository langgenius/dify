'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'

import useDocumentTitle from '@/hooks/use-document-title'
import { useInvitationCheck } from '@/service/use-common'
import { cn } from '@/utils/classnames'

const ActivateForm = () => {
  useDocumentTitle('')
  const router = useRouter()
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const workspaceID = searchParams.get('workspace_id')
  const email = searchParams.get('email')
  const token = searchParams.get('token')

  const checkParams = {
    url: '/activate/check',
    params: {
      ...workspaceID && { workspace_id: workspaceID },
      ...email && { email },
      token,
    },
  }
  const { data: checkRes } = useInvitationCheck({
    ...checkParams.params,
    token: token || undefined,
  }, true)

  useEffect(() => {
    if (checkRes?.is_valid) {
      const params = new URLSearchParams(searchParams)
      const { email, workspace_id } = checkRes.data
      params.set('email', encodeURIComponent(email))
      params.set('workspace_id', encodeURIComponent(workspace_id))
      params.set('invite_token', encodeURIComponent(token as string))
      router.replace(`/signin?${params.toString()}`)
    }
  }, [checkRes, router, searchParams, token])

  return (
    <div className={
      cn(
        'flex w-full grow flex-col items-center justify-center',
        'px-6',
        'md:px-[108px]',
      )
    }
    >
      {!checkRes && <Loading />}
      {checkRes && !checkRes.is_valid && (
        <div className="flex flex-col md:w-[400px]">
          <div className="mx-auto w-full">
            <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-[20px] border border-divider-regular bg-components-option-card-option-bg p-5 text-[40px] font-bold shadow-lg">🤷‍♂️</div>
            <h2 className="text-[32px] font-bold text-text-primary">{t('invalid', { ns: 'login' })}</h2>
          </div>
          <div className="mx-auto mt-6 w-full">
            <Button variant="primary" className="w-full !text-sm">
              <a href="https://dify.ai">{t('explore', { ns: 'login' })}</a>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ActivateForm
