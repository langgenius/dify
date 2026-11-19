'use client'
import type { Locale } from '@/i18n'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxInputTrigger,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxItemText,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  createComboboxItems,
} from '@langgenius/dify-ui/combobox'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { TimezoneCombobox } from '@/features/account-profile/timezone-combobox'
import useDocumentTitle from '@/hooks/use-document-title'
import { i18n } from '@/i18n'
import { setLocaleOnClient } from '@/i18n/client'
import { languages } from '@/i18n/language'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/console'
import { isUnauthorizedError } from '@/service/http-error'
import { replaceLoginRedirect } from '@/utils/login-redirect.client'
import { getBrowserTimezone } from '@/utils/timezone'
import { basePath } from '@/utils/var'
import { isInvitationForAccount } from '../utils/invitation-account'
import { resolvePostLoginRedirect } from '../utils/post-login-redirect'

const supportedLanguages = languages.filter((item) => item.supported)
const languageItems = createComboboxItems(supportedLanguages, {
  getValue: (item) => item.value,
  getLabel: (item) => item.name,
})

const getInitialLanguage = (locale: Locale): Locale => {
  if (supportedLanguages.some((item) => item.value === locale)) return locale

  return i18n.defaultLocale
}

export default function InviteSettingsPage() {
  const { t } = useTranslation(['common', 'login'])
  const router = useRouter()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const token = decodeURIComponent(searchParams.get('invite_token') as string)
  const {
    data: userResp,
    isPending: isProfilePending,
    error: profileError,
  } = useQuery({
    ...userProfileQueryOptions(),
    throwOnError: (err) => !isUnauthorizedError(err),
    refetchOnWindowFocus: false,
  })
  const locale = useLocale()
  const [name, setName] = useState('')
  const [isActivating, setIsActivating] = useState(false)
  const [language, setLanguage] = useState(() => getInitialLanguage(locale))
  const [timezone, setTimezone] = useState(() => getBrowserTimezone() || 'America/Los_Angeles')

  const checkParams = {
    url: '/activate/check',
    params: {
      token,
    },
  }
  const { data: checkRes, refetch: recheck } = useQuery(
    consoleQuery.activate.check.get.queryOptions({
      input: { query: checkParams.params },
      enabled: !!token,
      retry: false,
    }),
  )
  const isInvitationForCurrentAccount = isInvitationForAccount(
    checkRes?.data?.email,
    userResp?.profile.email,
  )
  const shouldReturnToSignIn =
    !isProfilePending &&
    Boolean(
      checkRes?.is_valid &&
      (isUnauthorizedError(profileError) || (userResp && !isInvitationForCurrentAccount)),
    )
  const requiresAccountSetup =
    checkRes?.data?.requires_setup ?? checkRes?.data?.account_status === 'pending'
  const setupAccountTitle = t(($) => $.setYourAccount, { ns: 'login' })
  const workspaceInvitationTitle = checkRes?.data?.workspace_name
    ? t(($) => $.joinWorkspace, {
        ns: 'login',
        workspaceName: checkRes.data.workspace_name,
      })
    : setupAccountTitle
  const documentTitle = !checkRes
    ? setupAccountTitle
    : !checkRes.is_valid
      ? t(($) => $.invalid, { ns: 'login' })
      : requiresAccountSetup || !checkRes.data?.workspace_name
        ? setupAccountTitle
        : workspaceInvitationTitle
  useDocumentTitle(documentTitle)

  useEffect(() => {
    if (!shouldReturnToSignIn) return

    router.replace(`/signin?${searchParams.toString()}`)
  }, [router, searchParams, shouldReturnToSignIn])

  const handleActivate = useCallback(async () => {
    try {
      if (isActivating) return
      if (!isInvitationForCurrentAccount) return
      setIsActivating(true)
      const body = requiresAccountSetup
        ? {
            token,
            name,
            interface_language: language,
            timezone,
          }
        : {
            token,
          }
      const res = await consoleClient.activate.post({ body })
      if (res.result === 'success') {
        // Tokens are now stored in cookies by the backend
        if (requiresAccountSetup) await setLocaleOnClient(language!)
        await queryClient.resetQueries({ queryKey: consoleQuery.account.profile.get.key() })
        replaceLoginRedirect(resolvePostLoginRedirect(searchParams), router.replace, basePath)
      }
    } catch {
      recheck()
      setIsActivating(false)
    }
  }, [
    isInvitationForCurrentAccount,
    isActivating,
    language,
    name,
    queryClient,
    recheck,
    requiresAccountSetup,
    searchParams,
    timezone,
    token,
    router,
  ])

  if (isProfilePending || shouldReturnToSignIn || !checkRes) return <LoadingPlaceholder />
  if (!checkRes.is_valid) {
    return (
      <div className="flex flex-col">
        <div className="mx-auto w-full">
          <div className="mb-3 flex size-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle text-2xl font-bold shadow-lg">
            🤷‍♂️
          </div>
          <h1 className="title-4xl-semi-bold text-text-primary">
            {t(($) => $.invalid, { ns: 'login' })}
          </h1>
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
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-100 flex-col gap-3">
      <div className="inline-flex size-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge shadow-lg">
        <span
          className="i-ri-account-circle-line size-6 text-text-accent-light-mode-only"
          aria-hidden="true"
        />
      </div>
      <h1 className="pt-2 pb-4 title-4xl-semi-bold wrap-anywhere text-text-primary">
        {requiresAccountSetup
          ? t(($) => $.setYourAccount, { ns: 'login' })
          : workspaceInvitationTitle}
      </h1>
      <Form
        className="grid min-w-0 gap-5"
        onKeyDown={(event) => {
          const { target, key, nativeEvent } = event
          if (
            key === 'Enter' &&
            !nativeEvent.isComposing &&
            target instanceof HTMLInputElement &&
            target.getAttribute('role') === 'combobox' &&
            target.getAttribute('aria-expanded') === 'true'
          )
            event.preventDefault()
        }}
        onFormSubmit={() => {
          void handleActivate()
        }}
      >
        {requiresAccountSetup && (
          <>
            <Field
              name="name"
              validate={(value) => {
                const nameValue = String(value)
                return !nameValue || nameValue.trim()
                  ? null
                  : t(($) => $.enterYourName, { ns: 'login' })
              }}
            >
              <FieldLabel>{t(($) => $.name, { ns: 'login' })}</FieldLabel>
              <Input
                type="text"
                required
                value={name}
                onValueChange={setName}
                placeholder={t(($) => $.namePlaceholder, { ns: 'login' })}
              />
              <FieldError>{t(($) => $.enterYourName, { ns: 'login' })}</FieldError>
            </Field>
            <Field name="interface_language">
              <FieldLabel>{t(($) => $.interfaceLanguage, { ns: 'login' })}</FieldLabel>
              <Combobox
                items={languageItems}
                value={language}
                onValueChange={(value, details) => {
                  if (value === null) details.cancel()
                  else setLanguage(value)
                }}
              >
                <ComboboxInputGroup>
                  <ComboboxInput spellCheck={false} />
                  <ComboboxInputTrigger
                    aria-label={t(($) => $['placeholder.select'], { ns: 'common' })}
                  />
                </ComboboxInputGroup>
                <ComboboxPortal>
                  <ComboboxPositioner>
                    <ComboboxPopup>
                      <ComboboxEmpty>
                        {t(($) => $['dynamicSelect.noData'], { ns: 'common' })}
                      </ComboboxEmpty>
                      <ComboboxList<(typeof supportedLanguages)[number]>>
                        {(item) => (
                          <ComboboxItem<Locale> key={item.value} value={item.value}>
                            <ComboboxItemText>{item.name}</ComboboxItemText>
                            <ComboboxItemIndicator />
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxPopup>
                  </ComboboxPositioner>
                </ComboboxPortal>
              </Combobox>
            </Field>
            <TimezoneCombobox
              label={t(($) => $.timezone, { ns: 'login' })}
              value={timezone}
              onValueChange={setTimezone}
            />
          </>
        )}
        <Button
          type="submit"
          variant="primary"
          className="h-auto min-h-8 w-full py-2 wrap-anywhere whitespace-normal"
          loading={isActivating}
        >
          {workspaceInvitationTitle}
        </Button>
      </Form>
    </div>
  )
}
