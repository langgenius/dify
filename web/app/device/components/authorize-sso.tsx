'use client'

import type { FC } from 'react'
import type { ApprovalContext } from '@/service/device-flow'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { approveExternal, fetchApprovalContext } from '@/service/device-flow'
import { approveErrorCopy } from '../utils/error-copy'

type Props = {
  onApproved: () => void
  onError: (message: string) => void
}

/**
 * AuthorizeSSO is the external-SSO branch authorize screen. On mount it
 * fetches /openapi/v1/oauth/device/approval-context to learn subject_email,
 * issuer, user_code, and csrf_token from the device_approval_grant cookie.
 * On Approve click, posts /openapi/v1/oauth/device/approve-external with
 * the CSRF header.
 *
 * The user_code in state is bound to the cookie by server; we do not accept
 * one from the URL because the SSO branch deliberately detaches from the
 * pre-SSO ?user_code=... query param.
 */
const AuthorizeSSO: FC<Props> = ({ onApproved, onError }) => {
  const { t } = useTranslation('deviceFlow')
  const [ctx, setCtx] = useState<ApprovalContext | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchApprovalContext()
      .then((c) => {
        if (!cancelled) {
          setCtx(c)
          setLoadErr(null)
        }
      })
      .catch((e) => {
        if (!cancelled)
          setLoadErr(approveErrorCopy(e, t))
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const approve = async () => {
    if (!ctx)
      return
    setBusy(true)
    try {
      await approveExternal(ctx, ctx.user_code)
      onApproved()
    }
    catch (e) {
      onError(approveErrorCopy(e, t))
    }
    finally {
      setBusy(false)
    }
  }

  // loadErr and loading states render without the icon-circle pattern intentionally —
  // they occur before the SSO identity is established, so there is no terminal
  // state to decorate. The page.tsx error_* states cover post-lookup failures.
  if (loadErr) {
    return (
      <div>
        <h2 className="text-2xl font-semibold text-text-primary">{t($ => $['authorize.sessionInvalidTitle'])}</h2>
        <p className="mt-2 text-sm text-text-secondary">
          <Trans
            i18nKey={$ => $['authorize.sessionInvalidBody']}
            ns="deviceFlow"
            components={{ codeTag: <code className="rounded bg-components-input-bg-normal px-1 font-mono" /> }}
          />
        </p>
      </div>
    )
  }
  if (!ctx) {
    return <div className="text-sm text-text-secondary">{t($ => $['authorize.loadingSession'])}</div>
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl font-semibold text-text-primary">{t($ => $['authorize.title'])}</h2>
        <p className="mt-2 text-sm text-text-secondary">
          {t($ => $['authorize.ssoSubtitle'])}
        </p>
      </div>
      <div className="flex items-center gap-2.5 rounded-lg bg-background-section-burn px-3 py-2.5">
        <Avatar
          size="md"
          avatar={null}
          name={ctx.subject_email}
        />
        <div>
          <p className="text-sm font-semibold text-text-primary">{ctx.subject_email}</p>
          <p className="text-xs text-text-secondary">{t($ => $['authorize.viaSSO'])}</p>
        </div>
      </div>
      {ctx.subject_issuer && (
        <div className="rounded-lg bg-background-section-burn px-3 py-2 text-sm text-text-secondary">
          {t($ => $['authorize.identityProvider'])}
          {' '}
          <span className="font-semibold text-text-primary">{ctx.subject_issuer}</span>
        </div>
      )}
      <Button
        variant="primary"
        size="large"
        className="w-full"
        onClick={approve}
        disabled={busy}
      >
        {t($ => $['authorize.approve'])}
      </Button>
    </div>
  )
}

export default AuthorizeSSO
