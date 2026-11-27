'use client'
import type { Locale } from '@/i18n'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { safe } from '@orpc/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { toast } from '@/app/notifications'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { TimezoneCombobox } from '@/features/account-profile/timezone-combobox'
import useDocumentTitle from '@/hooks/use-document-title'
import { i18n } from '@/i18n'
import { setLocaleOnClient } from '@/i18n/client'
import { languages } from '@/i18n/language'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/console'
import { isUnauthorizedError } from '@/service/http-error'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import {
  useRequestErrorDescriber,
  useRequestErrorMessage,
} from '@/service/use-request-error-message'
import { replaceLoginRedirect } from '@/utils/login-redirect.client'
import { getBrowserTimezone } from '@/utils/timezone'
import { basePath } from '@/utils/var'
import { isInvitationForAccount } from '../utils/invitation-account'
import { resolvePostLoginRedirect } from '../utils/post-login-redirect'

const languageItems = languages
  .filter((item) => item.supported)
  .map((item) => ({ value: item.value, label: item.name }))

const getInitialLanguage = (locale: Locale): Locale => {
  if (languageItems.some((item) => item.value === locale)) return locale

  return i18n.defaultLocale
}

export default function InviteSettingsPage() {
  const { t } = useTranslation(['common', 'login'])
  const describeRequestError = useRequestErrorDescriber()
  const router = useRouter()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const token = decodeURIComponent(searchParams.get('invite_token') as string)
  const { data: userResp, isPending: isProfilePending } = useQuery({
    ...userProfileQueryOptions(),
    throwOnError: (err) => !isUnauthorizedError(err),
    refetchOnWindowFocus: false,
  })
  const locale = useLocale()
  const [name, setName] = useState('')
  const [isActivating, setIsActivating] = useState(false)
  const [isWorkspaceFull, setIsWorkspaceFull] = useState(false)
  const [language, setLanguage] = useState(() => getInitialLanguage(locale))
  const [timezone, setTimezone] = useState(() => getBrowserTimezone() || 'America/Los_Angeles')

  const checkParams = {
    url: '/activate/check',
    params: {
      token,
    },
  }
  const checkQuery = useQuery(
    consoleQuery.activate.check.get.queryOptions({
      input: { query: checkParams.params },
      enabled: !!token,
      retry: false,
    }),
  )
  const { data: checkRes, refetch: recheck } = checkQuery
  // The check's failure renders once the profile has settled.
  const checkLoad = useOwnedQueryError(checkQuery, !isProfilePending)
  const checkErrorMessage = useRequestErrorMessage(
    checkLoad?.error,
    t(($) => $['api.actionFailed'], { ns: 'common' }),
  )
  const isInvitationForCurrentAccount = isInvitationForAccount(
    checkRes?.data?.email,
    userResp?.profile.email,
  )
  // Any profile failure other than a 401 throws to the error boundary, so a settled profile
  // without data means the visitor is signed out; either way they sign in again.
  const shouldReturnToSignIn =
    !isProfilePending && Boolean(checkRes?.is_valid && !isInvitationForCurrentAccount)
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
      setIsWorkspaceFull(false)
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
      const [error, res, isDefined] = await safe(consoleClient.activate.post({ body }))
      if (error) {
        setIsActivating(false)
        if (isDefined && error.code === 'workspace_member_limit_reached') {
          setIsWorkspaceFull(true)
          return
        }
        toast.error(
          describeRequestError(
            error,
            t(($) => $['api.actionFailed'], { ns: 'common' }),
          ),
        )
        recheck()
        return
      }
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
    describeRequestError,
    isInvitationForCurrentAccount,
    isActivating,
    language,
    name,
    queryClient,
    recheck,
    requiresAccountSetup,
    searchParams,
    t,
    timezone,
    token,
    router,
  ])

  if (!isProfilePending && checkLoad) {
    return (
      <Alert type="error">
        <AlertTitle>{checkErrorMessage}</AlertTitle>
        <AlertActions>
          <Button size="small" loading={checkLoad.retrying} onClick={checkLoad.retry}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </AlertActions>
      </Alert>
    )
  }
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
              <Select<Locale>
                items={languageItems}
                value={language}
                onValueChange={(value) => {
                  if (value !== null) setLanguage(value)
                }}
              >
                <SelectLabel>{t(($) => $.interfaceLanguage, { ns: 'login' })}</SelectLabel>
                <SelectTrigger>
                  <SelectValue<Locale> />
                </SelectTrigger>
                <SelectContent>
                  {languageItems.map((item) => (
                    <SelectItem<Locale> key={item.value} value={item.value}>
                      <SelectItemText>{item.label}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <TimezoneCombobox
              label={t(($) => $.timezone, { ns: 'login' })}
              value={timezone}
              onValueChange={setTimezone}
            />
          </>
        )}
        {isWorkspaceFull && (
          <Alert type="warning">
            <AlertTitle>{t(($) => $.invitationWorkspaceFull, { ns: 'login' })}</AlertTitle>
          </Alert>
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
