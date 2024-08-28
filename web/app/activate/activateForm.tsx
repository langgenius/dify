'use client'
import { useCallback, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { useRouter, useSearchParams } from 'next/navigation'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'

import { activateMember, invitationCheck } from '@/service/common'
import Toast from '@/app/components/base/toast'
import Loading from '@/app/components/base/loading'
import I18n from '@/context/i18n'
const validPassword = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/

const ActivateForm = () => {
  const router = useRouter()
  const { t } = useTranslation()
  const { locale, setLocaleOnClient } = useContext(I18n)
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
  const { data: checkRes, mutate: recheck } = useSWR(checkParams, invitationCheck, {
    revalidateOnFocus: false,
    onSuccess(data, key, config) {
      if (data.is_valid)
        router.replace(`/signin?space=${data.workspace_name}&email=${email}&token=${token}`)
    },
  })

  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [language, setLanguage] = useState(locale)
  const [showSuccess, setShowSuccess] = useState(false)

  const showErrorMessage = useCallback((message: string) => {
    Toast.notify({
      type: 'error',
      message,
    })
  }, [])

  const valid = useCallback(() => {
    if (!name.trim()) {
      showErrorMessage(t('login.error.nameEmpty'))
      return false
    }
    if (!password.trim()) {
      showErrorMessage(t('login.error.passwordEmpty'))
      return false
    }
    if (!validPassword.test(password)) {
      showErrorMessage(t('login.error.passwordInvalid'))
      return false
    }

    return true
  }, [name, password, showErrorMessage, t])

  const handleActivate = useCallback(async () => {
    if (!valid())
      return
    try {
      await activateMember({
        url: '/activate',
        body: {
          workspace_id: workspaceID,
          email,
          token,
          name,
          password,
          interface_language: language,
          timezone,
        },
      })
      setLocaleOnClient(language, false)
      setShowSuccess(true)
    }
    catch {
      recheck()
    }
  }, [email, language, name, password, recheck, setLocaleOnClient, timezone, token, valid, workspaceID])
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
