'use client'
import type { Reducer } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { SimpleSelect } from '@/app/components/base/select'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import { LICENSE_LINK } from '@/constants/link'
import { languages, LanguagesSupported } from '@/i18n-config/language'
import { useOneMoreStep } from '@/service/use-common'
import { timezones } from '@/utils/timezone'
import Input from '../components/base/input'

type IState = {
  invitation_code: string
  interface_language: string
  timezone: string
}

type IAction
  = | { type: 'failed', payload: null }
    | { type: 'invitation_code', value: string }
    | { type: 'interface_language', value: string }
    | { type: 'timezone', value: string }

const reducer: Reducer<IState, IAction> = (state: IState, action: IAction) => {
  switch (action.type) {
    case 'invitation_code':
      return { ...state, invitation_code: action.value }
    case 'interface_language':
      return { ...state, interface_language: action.value }
    case 'timezone':
      return { ...state, timezone: action.value }
    case 'failed':
      return {
        invitation_code: '',
        interface_language: 'en-US',
        timezone: 'Asia/Shanghai',
      }
    default:
      throw new Error('Unknown action.')
  }
}

const OneMoreStep = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [state, dispatch] = useReducer(reducer, {
    invitation_code: searchParams.get('invitation_code') || '',
    interface_language: 'en-US',
    timezone: 'Asia/Shanghai',
  })
  const { mutateAsync: submitOneMoreStep, isPending } = useOneMoreStep()

  const handleSubmit = async () => {
    if (isPending)
      return
    try {
      await submitOneMoreStep({
        invitation_code: state.invitation_code,
        interface_language: state.interface_language,
        timezone: state.timezone,
      })
      router.push('/apps')
    }
    catch (error: any) {
      if (error && error.status === 400)
        Toast.notify({ type: 'error', message: t('invalidInvitationCode', { ns: 'login' }) })
      dispatch({ type: 'failed', payload: null })
    }
  }

  return (
    <>
      <div className="mx-auto w-full">
        <h2 className="title-4xl-semi-bold text-text-secondary">{t('oneMoreStep', { ns: 'login' })}</h2>
        <p className="body-md-regular mt-1 text-text-tertiary">{t('createSample', { ns: 'login' })}</p>
      </div>

      <div className="mx-auto mt-6 w-full">
        <div className="relative">
          <div className="mb-5">
            <label className="system-md-semibold my-2 flex items-center justify-between text-text-secondary">
              {t('invitationCode', { ns: 'login' })}
              <Tooltip
                popupContent={(
                  <div className="w-[256px] text-xs font-medium">
                    <div className="font-medium">{t('sendUsMail', { ns: 'login' })}</div>
                    <div className="cursor-pointer text-xs font-medium text-text-accent-secondary">
                      <a href="mailto:request-invitation@langgenius.ai">request-invitation@langgenius.ai</a>
                    </div>
                  </div>
                )}
              >
                <span className="cursor-pointer text-text-accent-secondary">{t('dontHave', { ns: 'login' })}</span>
              </Tooltip>
            </label>
            <div className="mt-1">
              <Input
                id="invitation_code"
                value={state.invitation_code}
                type="text"
                placeholder={t('invitationCodePlaceholder', { ns: 'login' }) || ''}
                onChange={(e) => {
                  dispatch({ type: 'invitation_code', value: e.target.value.trim() })
                }}
              />
            </div>
          </div>
          <div className="mb-5">
            <label htmlFor="name" className="system-md-semibold my-2 text-text-secondary">
              {t('interfaceLanguage', { ns: 'login' })}
            </label>
            <div className="mt-1">
              <SimpleSelect
                defaultValue={LanguagesSupported[0]}
                items={languages.filter(item => item.supported)}
                onSelect={(item) => {
                  dispatch({ type: 'interface_language', value: item.value as typeof LanguagesSupported[number] })
                }}
              />
            </div>
          </div>
          <div className="mb-4">
            <label htmlFor="timezone" className="system-md-semibold text-text-tertiary">
              {t('timezone', { ns: 'login' })}
            </label>
            <div className="mt-1">
              <SimpleSelect
                defaultValue={state.timezone}
                items={timezones}
                onSelect={(item) => {
                  dispatch({ type: 'timezone', value: item.value as typeof state.timezone })
                }}
              />
            </div>
          </div>
          <div>
            <Button
              variant="primary"
              className="w-full"
              disabled={isPending}
              onClick={handleSubmit}
            >
              {t('go', { ns: 'login' })}
            </Button>
          </div>
          <div className="system-xs-regular mt-2 block w-full text-text-tertiary">
            {t('license.tip', { ns: 'login' })}
            &nbsp;
            <Link
              className="system-xs-medium text-text-accent-secondary"
              target="_blank"
              rel="noopener noreferrer"
              href={LICENSE_LINK}
            >
              {t('license.link', { ns: 'login' })}
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}

export default OneMoreStep
