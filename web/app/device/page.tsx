'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import { useQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { commonQueryKeys, userProfileQueryOptions } from '@/service/use-common'
import { post } from '@/service/base'
import type { ICurrentWorkspace } from '@/models/common'
import { deviceLookup } from '@/service/device-flow'
import CodeInput from './components/code-input'
import Chooser from './components/chooser'
import AuthorizeAccount from './components/authorize-account'
import AuthorizeSSO from './components/authorize-sso'
import { isValidUserCode } from './utils/user-code'
import { classifyLookupError } from './utils/error-copy'

type View =
  | { kind: 'code_entry' }
  | { kind: 'chooser'; userCode: string }
  | { kind: 'authorize_account'; userCode: string }
  | { kind: 'authorize_sso' }
  | { kind: 'success' }
  | { kind: 'error_expired' }
  | { kind: 'error_rate_limited' }
  | { kind: 'error_lookup_failed' }

export default function DevicePage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const urlUserCode = (searchParams.get('user_code') || '').trim().toUpperCase()
  const ssoVerified = searchParams.get('sso_verified') === '1'

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
  const { data: currentWorkspace } = useQuery<ICurrentWorkspace>({
    queryKey: commonQueryKeys.currentWorkspace,
    queryFn: () => post<ICurrentWorkspace>('/workspaces/current'),
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
    if (view.kind !== 'code_entry' && view.kind !== 'chooser') return
    let consumed = false
    if (ssoVerified) {
      setView({ kind: 'authorize_sso' })
      consumed = true
    }
    else if (urlUserCode && isValidUserCode(urlUserCode)) {
      if (account)
        setView({ kind: 'authorize_account', userCode: urlUserCode })
      else
        setView({ kind: 'chooser', userCode: urlUserCode })
      consumed = true
    }
    if (consumed && (urlUserCode || ssoVerified))
      router.replace(pathname)
  }, [urlUserCode, ssoVerified, account, view.kind, router, pathname])

  const onContinue = async () => {
    if (!isValidUserCode(typed)) return
    try {
      const reply = await deviceLookup(typed)
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
    if (account) setView({ kind: 'authorize_account', userCode: typed })
    else setView({ kind: 'chooser', userCode: typed })
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 py-10">
      <div className="w-full rounded-xl border border-components-panel-border bg-components-panel-bg p-8 shadow-sm">
        {view.kind === 'code_entry' && (
          <div className="flex flex-col gap-5">
            <div>
              <h1 className="text-2xl font-semibold text-text-primary">Authorize Dify CLI</h1>
              <p className="mt-2 text-sm text-text-secondary">
                Enter the code shown in your terminal.
              </p>
            </div>
            <CodeInput value={typed} onChange={setTyped} autoFocus />
            <button
              onClick={onContinue}
              disabled={!isValidUserCode(typed)}
              className="rounded-lg bg-components-button-primary-bg px-4 py-3 text-components-button-primary-text font-medium hover:bg-components-button-primary-bg-hover disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        )}

        {view.kind === 'chooser' && (
          <div className="flex flex-col gap-5">
            <div>
              <h1 className="text-2xl font-semibold text-text-primary">Sign in to authorize</h1>
              <p className="mt-2 text-sm text-text-secondary">
                Code <span className="font-mono">{view.userCode}</span> is valid. Choose how to sign in.
              </p>
            </div>
            <Chooser userCode={view.userCode} ssoAvailable={ssoAvailable} />
          </div>
        )}

        {view.kind === 'authorize_account' && (
          <AuthorizeAccount
            userCode={view.userCode}
            accountEmail={account?.email}
            defaultWorkspace={currentWorkspace?.name}
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
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">You&apos;re signed in</h1>
            <p className="mt-2 text-sm text-text-secondary">Return to your terminal to continue.</p>
          </div>
        )}

        {view.kind === 'error_expired' && (
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">This code is no longer valid</h1>
            <p className="mt-2 text-sm text-text-secondary">
              The code may have expired or already been used. Run
              {' '}
              <code className="rounded bg-components-panel-bg px-1">difyctl auth login</code>
              {' '}
              again to get a new one.
            </p>
          </div>
        )}

        {view.kind === 'error_rate_limited' && (
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Too many attempts</h1>
            <p className="mt-2 text-sm text-text-secondary">
              We&apos;ve received too many requests for this code. Wait a moment and try again.
            </p>
          </div>
        )}

        {view.kind === 'error_lookup_failed' && (
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Could not verify the code</h1>
            <p className="mt-2 text-sm text-text-secondary">
              Something went wrong on our side. Try again in a moment.
            </p>
          </div>
        )}

        {errMsg && (
          <p className="mt-4 text-sm text-text-destructive">{errMsg}</p>
        )}
      </div>
    </main>
  )
}
