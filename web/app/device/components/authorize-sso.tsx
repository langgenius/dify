'use client'

import type { FC } from 'react'
import type { ApprovalContext } from '@/service/device-flow'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { useEffect, useState } from 'react'
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
      .then((c) => {
        if (!cancelled)
          setCtx(c)
      })
      .catch((e) => {
        if (!cancelled)
          setLoadErr(approveErrorCopy(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const approve = async () => {
    if (!ctx)
      return
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

  // loadErr and loading states render without the icon-circle pattern intentionally —
  // they occur before the SSO identity is established, so there is no terminal
  // state to decorate. The page.tsx error_* states cover post-lookup failures.
  if (loadErr) {
    return (
      <div>
        <h2 className="text-2xl font-semibold text-text-primary">This session is no longer valid</h2>
        <p className="mt-2 text-sm text-text-secondary">
          Run
          {' '}
          <code className="rounded bg-components-input-bg-normal px-1 font-mono">difyctl auth login</code>
          {' '}
          again to start a new sign-in.
        </p>
      </div>
    )
  }
  if (!ctx) {
    return <div className="text-sm text-text-secondary">Loading session…</div>
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl font-semibold text-text-primary">Authorize Dify CLI</h2>
        <p className="mt-2 text-sm text-text-secondary">
          difyctl is requesting access via SSO. If you didn&apos;t start this from your terminal, close this tab.
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
          <p className="text-xs text-text-secondary">via SSO</p>
        </div>
      </div>
      {ctx.subject_issuer && (
        <div className="rounded-lg bg-background-section-burn px-3 py-2 text-sm text-text-secondary">
          Identity provider:
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
        Authorize
      </Button>
    </div>
  )
}

export default AuthorizeSSO
