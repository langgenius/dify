'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { deviceLookup } from '@/service/device-flow'
import AuthorizeAccount from './components/authorize-account'
import AuthorizeSSO from './components/authorize-sso'
import Chooser from './components/chooser'
import CodeInput from './components/code-input'
import { classifyLookupError, ssoErrorCopy } from './utils/error-copy'
import { isValidUserCode } from './utils/user-code'

type View
  = | { kind: 'code_entry' }
    | { kind: 'chooser', userCode: string }
    | { kind: 'authorize_account', userCode: string }
    | { kind: 'authorize_sso' }
    | { kind: 'success' }
    | { kind: 'error_expired' }
    | { kind: 'error_rate_limited' }
    | { kind: 'error_lookup_failed' }
    | { kind: 'error_sso', code: string, userCode: string }

export default function DevicePage() {
  const { t } = useTranslation('deviceFlow')
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const urlUserCode = (searchParams.get('user_code') || '').trim().toUpperCase()
  const ssoVerified = searchParams.get('sso_verified') === '1'
  const ssoError = searchParams.get('sso_error') || ''

  const [typed, setTyped] = useState('')
  const [view, setView] = useState<View>({ kind: 'code_entry' })
  const [errMsg, setErrMsg] = useState<string | null>(null)

  // Account subject + workspace identity (for the authorize-account screen).
  // Logged-out is a valid landing state on /device — disable refetch storms
  // and skip workspace probe until profile resolves (avoids /current + chained
  // /refresh-token 401 loops while the user is still entering the code).
  const { data: userResp, isError: profileErr } = useQuery({
    ...userProfileQueryOptions(),
    throwOnError: false,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  })
  const account = userResp?.profile
  const { data: currentWorkspace } = useQuery({
    ...consoleQuery.workspaces.current.post.queryOptions(),
    enabled: !!account && !profileErr,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const { data: sys } = useQuery(systemFeaturesQueryOptions())
  // Device-flow SSO branch uses external-user (webapp) SSO, not console SSO —
  // backend mints EXTERNAL_SSO tokens via Enterprise's external ACS. Gate on
  // webapp_auth.{enabled, allow_sso} + a configured webapp SSO protocol.
  const ssoAvailable = !!sys?.webapp_auth?.enabled
    && !!sys?.webapp_auth?.allow_sso
    && (sys?.webapp_auth?.sso_config?.protocol || '') !== ''

  // URL-driven view transitions. Only advances while the user is still on
  // the entry/chooser screens — never clobbers terminal views (success /
  // error_expired / authorize_*) when userProfile refetches.
  // After consuming the params, scrub them from the URL so they don't
  // leak via history / Referer / server logs (RFC 8628 §5.4).
  useEffect(() => {
    if (view.kind !== 'code_entry' && view.kind !== 'chooser')
      return
    if (ssoError) {
      setView({ kind: 'error_sso', code: ssoError, userCode: urlUserCode }) // eslint-disable-line react/set-state-in-effect
      router.replace(pathname)
      return
    }
    // Post-login bounce: chooser holds the typed code, account just loaded.
    // The URL was already scrubbed on the first effect run, so urlUserCode
    // is empty here — advance using the userCode stashed in view state.
    if (view.kind === 'chooser' && account) {
      setView({ kind: 'authorize_account', userCode: view.userCode }) // eslint-disable-line react/set-state-in-effect
      return
    }
    let consumed = false
    if (ssoVerified) {
      setView({ kind: 'authorize_sso' }) // eslint-disable-line react/set-state-in-effect
      consumed = true
    }
    else if (urlUserCode && isValidUserCode(urlUserCode)) {
      if (account)
        setView({ kind: 'authorize_account', userCode: urlUserCode }) // eslint-disable-line react/set-state-in-effect
      else
        setView({ kind: 'chooser', userCode: urlUserCode }) // eslint-disable-line react/set-state-in-effect
      consumed = true
    }
    if (consumed && (urlUserCode || ssoVerified))
      router.replace(pathname)
  }, [urlUserCode, ssoVerified, ssoError, account, view, router, pathname])

  const advanceFromCode = async (code: string) => {
    try {
      const reply = await deviceLookup(code)
      if (!reply.valid) {
        setView({ kind: 'error_expired' })
        return
      }
    }
    catch (e) {
      const outcome = classifyLookupError(e)
      if (outcome === 'rate_limited')
        setView({ kind: 'error_rate_limited' })
      else if (outcome === 'failed')
        setView({ kind: 'error_lookup_failed' })
      else
        setView({ kind: 'error_expired' })
      return
    }
    if (account)
      setView({ kind: 'authorize_account', userCode: code })
    else setView({ kind: 'chooser', userCode: code })
  }

  const onContinue = async () => {
    if (!isValidUserCode(typed))
      return
    await advanceFromCode(typed)
  }

  return (
    <>
      {view.kind === 'code_entry' && (
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">{t('codeEntry.title')}</h1>
            <p className="mt-2 text-sm text-text-secondary">
              {t('codeEntry.subtitle')}
            </p>
          </div>
          <CodeInput value={typed} onChange={setTyped} autoFocus />
          <Button
            variant="primary"
            size="large"
            className="w-full"
            onClick={onContinue}
            disabled={!isValidUserCode(typed)}
          >
            {t('codeEntry.continue')}
          </Button>
        </div>
      )}

      {view.kind === 'chooser' && (
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">{t('chooser.title')}</h1>
            <p className="mt-2 text-sm text-text-secondary">
              <Trans
                i18nKey="chooser.subtitle"
                ns="deviceFlow"
                values={{ code: view.userCode }}
                components={{ codeTag: <code className="rounded bg-components-input-bg-normal px-1 font-mono" /> }}
              />
            </p>
          </div>
          <Chooser userCode={view.userCode} ssoAvailable={ssoAvailable} />
        </div>
      )}

      {view.kind === 'authorize_account' && (
        <AuthorizeAccount
          userCode={view.userCode}
          accountEmail={account?.email}
          accountName={account?.name}
          accountAvatarUrl={account?.avatar_url ?? null}
          defaultWorkspace={currentWorkspace?.name ?? undefined}
          onApproved={() => setView({ kind: 'success' })}
          onDenied={() => setView({ kind: 'error_expired' })}
          onError={e => setErrMsg(e)}
        />
      )}

      {view.kind === 'authorize_sso' && (
        <AuthorizeSSO
          onApproved={() => setView({ kind: 'success' })}
          onError={e => setErrMsg(e)}
        />
      )}

      {view.kind === 'success' && (
        <div className="flex flex-col gap-1">
          <div className="mb-2.5 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-state-success-hover">
            <span className="i-ri-checkbox-circle-line h-[18px] w-[18px] text-util-colors-green-green-600" />
          </div>
          <h1 className="text-xl font-semibold text-text-primary">{t('success.title')}</h1>
          <p className="text-sm text-text-secondary">{t('success.subtitle')}</p>
          <Divider className="my-3" />
          <Button variant="ghost" className="w-full" onClick={() => router.push('/')}>
            {t('success.goToConsole')}
          </Button>
        </div>
      )}

      {view.kind === 'error_expired' && (
        <div className="flex flex-col gap-1">
          <div className="mb-2.5 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-state-warning-hover">
            <span className="i-ri-error-warning-line h-[18px] w-[18px] text-util-colors-yellow-yellow-600" />
          </div>
          <h1 className="text-xl font-semibold text-text-primary">{t('errorExpired.title')}</h1>
          <p className="text-sm text-text-secondary">
            <Trans
              i18nKey="errorExpired.body"
              ns="deviceFlow"
              components={{ codeTag: <code className="rounded bg-components-input-bg-normal px-1 font-mono" /> }}
            />
          </p>
          <Divider className="my-3" />
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setView({ kind: 'code_entry' })
              setErrMsg(null)
            }}
          >
            {t('errorExpired.tryDifferentCode')}
          </Button>
        </div>
      )}

      {view.kind === 'error_rate_limited' && (
        <div className="flex flex-col gap-1">
          <div className="mb-2.5 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-state-warning-hover">
            <span className="i-ri-error-warning-line h-[18px] w-[18px] text-util-colors-yellow-yellow-600" />
          </div>
          <h1 className="text-xl font-semibold text-text-primary">{t('errorRateLimited.title')}</h1>
          <p className="text-sm text-text-secondary">{t('errorRateLimited.body')}</p>
          <Divider className="my-3" />
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setView({ kind: 'code_entry' })
              setErrMsg(null)
            }}
          >
            {t('tryAgain')}
          </Button>
        </div>
      )}

      {view.kind === 'error_lookup_failed' && (
        <div className="flex flex-col gap-1">
          <div className="mb-2.5 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-state-destructive-hover">
            <span className="i-ri-close-circle-line h-[18px] w-[18px] text-util-colors-red-red-600" />
          </div>
          <h1 className="text-xl font-semibold text-text-primary">{t('errorLookupFailed.title')}</h1>
          <p className="text-sm text-text-secondary">
            {t('errorLookupFailed.body')}
          </p>
          <Divider className="my-3" />
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setView({ kind: 'code_entry' })
              setErrMsg(null)
            }}
          >
            {t('tryAgain')}
          </Button>
        </div>
      )}

      {view.kind === 'error_sso' && (
        <div className="flex flex-col gap-1">
          <div className="mb-2.5 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-state-warning-hover">
            <span aria-hidden="true" className="i-ri-error-warning-line h-[18px] w-[18px] text-util-colors-yellow-yellow-600" />
          </div>
          <h1 className="text-xl font-semibold text-text-primary">{t('errorSso.title')}</h1>
          <p className="text-sm text-text-secondary">{ssoErrorCopy(view.code, t)}</p>
          <Divider className="my-3" />
          <Button
            variant="primary"
            size="large"
            className="w-full"
            onClick={() => {
              setErrMsg(null)
              if (view.userCode)
                advanceFromCode(view.userCode)
              else
                setView({ kind: 'code_entry' })
            }}
          >
            {t('errorSso.backToLoginOptions')}
          </Button>
        </div>
      )}

      {errMsg && (
        <p className="mt-4 text-sm text-text-destructive">{errMsg}</p>
      )}
    </>
  )
}
