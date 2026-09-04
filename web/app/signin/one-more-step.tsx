'use client'
import type { Reducer } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { resolvePostLoginRedirect } from '@/app/signin/utils/post-login-redirect'
import { LICENSE_LINK } from '@/constants/link'
import { languages } from '@/i18n-config/language'
import Link from '@/next/link'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { useOneMoreStep } from '@/service/use-common'
import { replaceLoginRedirect } from '@/utils/login-redirect.client'
import { timezones } from '@/utils/timezone'
import { basePath } from '@/utils/var'

type IState = {
  invitation_code: string
  interface_language: string
  timezone: string
}

type IAction =
  | { type: 'invitation_code'; value: string }
  | { type: 'interface_language'; value: string }
  | { type: 'timezone'; value: string }

const reducer: Reducer<IState, IAction> = (state: IState, action: IAction) => {
  switch (action.type) {
    case 'invitation_code':
      return { ...state, invitation_code: action.value }
    case 'interface_language':
      return { ...state, interface_language: action.value }
    case 'timezone':
      return { ...state, timezone: action.value }
    default:
      throw new Error('Unknown action.')
  }
}

type SelectOption = {
  value: string
  name: string
}

const LANGUAGE_OPTIONS: SelectOption[] = languages.filter((item) => item.supported)
const TIMEZONE_OPTIONS: SelectOption[] = timezones.map((item) => ({
  value: String(item.value),
  name: item.name,
}))

const hasStatus = (error: unknown): error is { status: number } => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  )
}

const OneMoreStep = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()

  const [state, dispatch] = useReducer(reducer, {
    invitation_code: searchParams.get('invitation_code') || '',
    interface_language: 'en-US',
    timezone: 'Asia/Shanghai',
  })
  const { mutateAsync: submitOneMoreStep, isPending } = useOneMoreStep()
  const selectedLanguage = LANGUAGE_OPTIONS.find((item) => item.value === state.interface_language)
  const selectedTimezone = TIMEZONE_OPTIONS.find((item) => item.value === state.timezone)

  const handleLanguageChange = (nextValue: string | null) => {
    const nextLanguage = LANGUAGE_OPTIONS.find((item) => item.value === nextValue)
    if (nextLanguage) dispatch({ type: 'interface_language', value: nextLanguage.value })
  }

  const handleTimezoneChange = (nextValue: string | null) => {
    const nextTimezone = TIMEZONE_OPTIONS.find((item) => item.value === nextValue)
    if (nextTimezone) dispatch({ type: 'timezone', value: nextTimezone.value })
  }

  const handleSubmit = async () => {
    if (isPending) return
    try {
      await submitOneMoreStep({
        invitation_code: state.invitation_code.trim(),
        interface_language: state.interface_language,
        timezone: state.timezone,
      })
      await queryClient.resetQueries({ queryKey: consoleQuery.account.profile.get.key() })
      replaceLoginRedirect(resolvePostLoginRedirect(searchParams), router.replace, basePath)
    } catch (error: unknown) {
      if (hasStatus(error) && error.status === 400)
        toast.error(t(($) => $.invalidInvitationCode, { ns: 'login' }))
    }
  }

  return (
    <>
      <div className="mx-auto w-full">
        <h1 className="title-4xl-semi-bold text-text-secondary">
          {t(($) => $.oneMoreStep, { ns: 'login' })}
        </h1>
        <p className="mt-1 body-md-regular text-text-tertiary">
          {t(($) => $.createSample, { ns: 'login' })}
        </p>
      </div>

      <div className="mx-auto mt-6 w-full">
        <Form
          className="relative"
          onFormSubmit={() => {
            void handleSubmit()
          }}
        >
          <Field name="invitation_code" className="mb-5">
            <div className="flex items-center justify-between system-md-semibold text-text-secondary">
              <FieldLabel>{t(($) => $.invitationCode, { ns: 'login' })}</FieldLabel>
              <Popover>
                <PopoverTrigger
                  openOnHover
                  render={
                    <button
                      type="button"
                      className="cursor-pointer rounded-sm text-text-accent-secondary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                    >
                      {t(($) => $.dontHave, { ns: 'login' })}
                    </button>
                  }
                />
                <PopoverContent
                  placement="top"
                  className="w-[256px] px-3 py-2 text-xs font-medium text-text-tertiary"
                >
                  <div>
                    <div className="font-medium">{t(($) => $.sendUsMail, { ns: 'login' })}</div>
                    <div className="cursor-pointer text-xs font-medium text-text-accent-secondary">
                      <a href="mailto:request-invitation@langgenius.ai">
                        request-invitation@langgenius.ai
                      </a>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <Input
              value={state.invitation_code}
              type="text"
              placeholder={t(($) => $.invitationCodePlaceholder, { ns: 'login' }) || ''}
              onValueChange={(value) => dispatch({ type: 'invitation_code', value })}
            />
          </Field>
          <Field name="interface_language" className="mb-5">
            <Select value={selectedLanguage?.value ?? null} onValueChange={handleLanguageChange}>
              <SelectLabel>{t(($) => $.interfaceLanguage, { ns: 'login' })}</SelectLabel>
              <SelectTrigger size="large">
                {selectedLanguage?.name ?? t(($) => $['placeholder.select'], { ns: 'common' })}
              </SelectTrigger>
              <SelectContent>
                {LANGUAGE_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    <SelectItemText>{item.name}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field name="timezone" className="mb-4">
            <Select value={selectedTimezone?.value ?? null} onValueChange={handleTimezoneChange}>
              <SelectLabel>{t(($) => $.timezone, { ns: 'login' })}</SelectLabel>
              <SelectTrigger size="large">
                {selectedTimezone?.name ?? t(($) => $['placeholder.select'], { ns: 'common' })}
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    <SelectItemText>{item.name}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={isPending}>
            {t(($) => $.go, { ns: 'login' })}
          </Button>
          <div className="mt-2 block w-full system-xs-regular text-text-tertiary">
            {t(($) => $['license.tip'], { ns: 'login' })}
            &nbsp;
            <Link
              className="system-xs-medium text-text-accent-secondary"
              target="_blank"
              rel="noopener noreferrer"
              href={LICENSE_LINK}
            >
              {t(($) => $['license.link'], { ns: 'login' })}
            </Link>
          </div>
        </Form>
      </div>
    </>
  )
}

export default OneMoreStep
