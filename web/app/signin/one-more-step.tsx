'use client'
import type { Reducer } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { toast } from '@langgenius/dify-ui/toast'
import { useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { LICENSE_LINK } from '@/constants/link'
import { languages } from '@/i18n-config/language'
import Link from '@/next/link'
import { useRouter, useSearchParams } from '@/next/navigation'
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

type SelectOption = {
  value: string
  name: string
}

const LANGUAGE_OPTIONS: SelectOption[] = languages.filter(item => item.supported)
const TIMEZONE_OPTIONS: SelectOption[] = timezones.map(item => ({
  value: String(item.value),
  name: item.name,
}))

const hasStatus = (error: unknown): error is { status: number } => {
  return typeof error === 'object'
    && error !== null
    && 'status' in error
    && typeof error.status === 'number'
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
  const selectedLanguage = LANGUAGE_OPTIONS.find(item => item.value === state.interface_language)
  const selectedTimezone = TIMEZONE_OPTIONS.find(item => item.value === state.timezone)

  const handleLanguageChange = (nextValue: string | null) => {
    const nextLanguage = LANGUAGE_OPTIONS.find(item => item.value === nextValue)
    if (nextLanguage)
      dispatch({ type: 'interface_language', value: nextLanguage.value })
  }

  const handleTimezoneChange = (nextValue: string | null) => {
    const nextTimezone = TIMEZONE_OPTIONS.find(item => item.value === nextValue)
    if (nextTimezone)
      dispatch({ type: 'timezone', value: nextTimezone.value })
  }

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
    catch (error: unknown) {
      if (hasStatus(error) && error.status === 400)
        toast.error(t('invalidInvitationCode', { ns: 'login' }))
      dispatch({ type: 'failed', payload: null })
    }
  }

  return (
    <>
      <div className="mx-auto w-full">
        <h2 className="title-4xl-semi-bold text-text-secondary">{t('oneMoreStep', { ns: 'login' })}</h2>
        <p className="mt-1 body-md-regular text-text-tertiary">{t('createSample', { ns: 'login' })}</p>
      </div>

      <div className="mx-auto mt-6 w-full">
        <div className="relative">
          <div className="mb-5">
            <div className="my-2 flex items-center justify-between system-md-semibold text-text-secondary">
              <label htmlFor="invitation_code">
                {t('invitationCode', { ns: 'login' })}
              </label>
              <Popover>
                <PopoverTrigger
                  openOnHover
                  render={(
                    <button
                      type="button"
                      className="cursor-pointer rounded-sm text-text-accent-secondary outline-hidden focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
                    >
                      {t('dontHave', { ns: 'login' })}
                    </button>
                  )}
                />
                <PopoverContent
                  placement="top"
                  popupClassName="w-[256px] px-3 py-2 text-xs font-medium text-text-tertiary"
                >
                  <div>
                    <div className="font-medium">{t('sendUsMail', { ns: 'login' })}</div>
                    <div className="cursor-pointer text-xs font-medium text-text-accent-secondary">
                      <a href="mailto:request-invitation@langgenius.ai">request-invitation@langgenius.ai</a>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
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
            <label htmlFor="interface_language" className="my-2 system-md-semibold text-text-secondary">
              {t('interfaceLanguage', { ns: 'login' })}
            </label>
            <div className="mt-1">
              <Select
                value={selectedLanguage?.value ?? null}
                onValueChange={handleLanguageChange}
              >
                <SelectTrigger id="interface_language" size="large">
                  {selectedLanguage?.name ?? t('placeholder.select', { ns: 'common' })}
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGE_OPTIONS.map(item => (
                    <SelectItem key={item.value} value={item.value}>
                      <SelectItemText>{item.name}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mb-4">
            <label htmlFor="timezone" className="system-md-semibold text-text-tertiary">
              {t('timezone', { ns: 'login' })}
            </label>
            <div className="mt-1">
              <Select
                value={selectedTimezone?.value ?? null}
                onValueChange={handleTimezoneChange}
              >
                <SelectTrigger id="timezone" size="large">
                  {selectedTimezone?.name ?? t('placeholder.select', { ns: 'common' })}
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map(item => (
                    <SelectItem key={item.value} value={item.value}>
                      <SelectItemText>{item.name}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          <div className="mt-2 block w-full system-xs-regular text-text-tertiary">
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
