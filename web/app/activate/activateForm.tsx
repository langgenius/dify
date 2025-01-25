'use client'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { useRouter, useSearchParams } from 'next/navigation'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'

import { invitationCheck } from '@/service/common'
import Loading from '@/app/components/base/loading'

const ActivateForm = () => {
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
  const { data: checkRes } = useSWR(checkParams, invitationCheck, {
    revalidateOnFocus: false,
    onSuccess(data) {
      if (data.is_valid) {
        const params = new URLSearchParams(searchParams)
        const { email, workspace_id } = data.data
        params.set('email', encodeURIComponent(email))
        params.set('workspace_id', encodeURIComponent(workspace_id))
        params.set('invite_token', encodeURIComponent(token as string))
        router.replace(`/signin?${params.toString()}`)
      }
    },
  })

  return (
    <div className={
      cn(
        'flex flex-col items-center w-full grow justify-center',
        'px-6',
        'md:px-[108px]',
      )
    }>
      {!checkRes && <Loading />}
      {checkRes && !checkRes.is_valid && (
        <div className="flex flex-col md:w-[400px]">
          <div className="w-full mx-auto">
            <div className="mb-3 flex justify-center items-center w-20 h-20 p-5 rounded-[20px] border border-gray-100 shadow-lg text-[40px] font-bold">🤷‍♂️</div>
            <h2 className="text-[32px] font-bold text-gray-900">{t('login.invalid')}</h2>
          </div>
          <div className="w-full mx-auto mt-6">
            <Button variant='primary' className='w-full !text-sm'>
              <a href="https://dify.ai">{t('login.explore')}</a>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ActivateForm
