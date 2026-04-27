'use client'

import type { FC } from 'react'
import { useEffect, useState } from 'react'
import type { ApprovalContext } from '@/service/device-flow'
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
  const [ctx, setCtx] = useState<ApprovalContext | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchApprovalContext()
      .then((c) => { if (!cancelled) setCtx(c) })
      .catch((e) => {
        if (!cancelled)
          setLoadErr(approveErrorCopy(e))
      })
    return () => { cancelled = true }
  }, [])

  const approve = async () => {
    if (!ctx) return
    setBusy(true)
    try {
      await approveExternal(ctx, ctx.user_code)
      onApproved()
    }
    catch (e) {
      onError(approveErrorCopy(e))
    }
    finally {
      setBusy(false)
    }
  }

  if (loadErr) {
    return (
      <div>
        <h2 className="text-2xl font-semibold text-text-primary">This session is no longer valid</h2>
        <p className="mt-2 text-sm text-text-secondary">
          Run <code className="rounded bg-components-panel-bg px-1">difyctl auth login</code> again to start a new sign-in.
        </p>
      </div>
    )
  }
  if (!ctx) {
    return <div className="text-sm text-text-secondary">Loading session…</div>
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold text-text-primary">Authorize Dify CLI</h2>
        <p className="mt-2 text-sm text-text-secondary">
          Dify CLI (difyctl) is requesting access via SSO. If you did not start
          this from your terminal, close this tab.
        </p>
      </div>
      <div className="rounded-lg border border-components-panel-border bg-components-panel-bg px-4 py-3">
        <p className="text-sm text-text-secondary">
          Signed in as <span className="font-medium text-text-primary">{ctx.subject_email}</span>
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Issuer: <span className="font-medium text-text-primary">{ctx.subject_issuer}</span>
        </p>
      </div>
      <button
        onClick={approve}
        disabled={busy}
        className="rounded-lg bg-components-button-primary-bg px-4 py-3 text-components-button-primary-text font-medium hover:bg-components-button-primary-bg-hover disabled:opacity-50"
      >
        Authorize
      </button>
    </div>
  )
}

export default AuthorizeSSO
