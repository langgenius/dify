'use client'
import React, { type Reducer, useEffect, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import useSWR from 'swr'
import { useRouter, useSearchParams } from 'next/navigation'
import Input from '../components/base/input'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import { SimpleSelect } from '@/app/components/base/select'
import { timezones } from '@/utils/timezone'
import { LanguagesSupported, languages } from '@/i18n/language'
import { oneMoreStep } from '@/service/common'
import Toast from '@/app/components/base/toast'

type IState = {
  formState: 'processing' | 'error' | 'success' | 'initial'
  invitation_code: string
  interface_language: string
  timezone: string
}

type IAction =
  | { type: 'failed', payload: null }
  | { type: 'invitation_code', value: string }
  | { type: 'interface_language', value: string }
  | { type: 'timezone', value: string }
  | { type: 'formState', value: 'processing' }

const reducer: Reducer<IState, IAction> = (state: IState, action: IAction) => {
  switch (action.type) {
    case 'invitation_code':
      return { ...state, invitation_code: action.value }
    case 'interface_language':
      return { ...state, interface_language: action.value }
    case 'timezone':
      return { ...state, timezone: action.value }
    case 'formState':
      return { ...state, formState: action.value }
    case 'failed':
      return {
        formState: 'initial',
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
    formState: 'initial',
    invitation_code: searchParams.get('invitation_code') || '',
    interface_language: 'en-US',
    timezone: 'Asia/Shanghai',
  })
  const { data, error } = useSWR(state.formState === 'processing'
    ? {
      url: '/account/init',
      body: {
        invitation_code: state.invitation_code,
        interface_language: state.interface_language,
        timezone: state.timezone,
      },
    }
    : null, oneMoreStep)

  useEffect(() => {
    if (error && error.status === 400) {
      Toast.notify({ type: 'error', message: t('login.invalidInvitationCode') })
      dispatch({ type: 'failed', payload: null })
    }
    if (data)
      router.push('/apps')
  }, [data, error])

  return (
    <>
      <div className="mx-auto w-full">
        <h2 className="title-4xl-semi-bold text-text-secondary">{t('login.oneMoreStep')}</h2>
        <p className='body-md-regular mt-1 text-text-tertiary'>{t('login.createSample')}</p>
      </div>

      <div className="mx-auto mt-6 w-full">
        <div className="relative">
          <div className="mb-5">
            <label className="system-md-semibold my-2 flex items-center justify-between text-text-secondary">
              {t('login.invitationCode')}
              <Tooltip
                popupContent={
                  <div className='w-[256px] text-xs font-medium'>
                    <div className='font-medium'>{t('login.sendUsMail')}</div>
                    <div className='cursor-pointer text-xs font-medium text-text-accent-secondary'>
                      <a href="mailto:request-invitation@langgenius.ai">request-invitation@langgenius.ai</a>
                    </div>
                  </div>
                }
                needsDelay
              >
                <span className='cursor-pointer text-text-accent-secondary'>{t('login.dontHave')}</span>
              </Tooltip>
            </label>
            <div className="mt-1">
              <Input
                id="invitation_code"
                value={state.invitation_code}
                type="text"
                placeholder={t('login.invitationCodePlaceholder') || ''}
                onChange={(e) => {
                  dispatch({ type: 'invitation_code', value: e.target.value.trim() })
                }}
              />
            </div>
          </div>
          <div className='mb-5'>
            <label htmlFor="name" className="system-md-semibold my-2 text-text-secondary">
              {t('login.interfaceLanguage')}
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
          <div className='mb-4'>
            <label htmlFor="timezone" className="system-md-semibold text-text-tertiary">
              {t('login.timezone')}
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
              variant='primary'
              className='w-full'
              disabled={state.formState === 'processing'}
              onClick={() => {
                dispatch({ type: 'formState', value: 'processing' })
              }}
            >
              {t('login.go')}
            </Button>
          </div>
          <div className="system-xs-regular mt-2 block w-full text-text-tertiary">
            {t('login.license.tip')}
            &nbsp;
            <Link
              className='system-xs-medium text-text-accent-secondary'
              target='_blank' rel='noopener noreferrer'
              href={'https://docs.dify.ai/user-agreement/open-source'}
            >{t('login.license.link')}</Link>
          </div>
        </div>
      </div>
    </>
  )
}

export default OneMoreStep
