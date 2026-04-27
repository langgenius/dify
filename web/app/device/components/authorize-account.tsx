'use client'

import type { FC } from 'react'
import { useState } from 'react'
import { deviceApproveAccount, deviceDenyAccount } from '@/service/device-flow'
import { approveErrorCopy } from '../utils/error-copy'

type Props = {
  userCode: string
  accountEmail?: string
  defaultWorkspace?: string
  onApproved: () => void
  onDenied: () => void
  onError: (message: string) => void
}

/**
 * AuthorizeAccount is the account-branch authorize screen. Called with a
 * live console session already established (user bounced through /signin).
 * Posts to /openapi/v1/oauth/device/{approve,deny}; these endpoints mint
 * the dfoa_ token server-side.
 */
const AuthorizeAccount: FC<Props> = ({
  userCode, accountEmail, defaultWorkspace, onApproved, onDenied, onError,
}) => {
  const [busy, setBusy] = useState(false)

  const approve = async () => {
    setBusy(true)
    try {
      await deviceApproveAccount(userCode)
      onApproved()
    }
    catch (e) {
      onError(approveErrorCopy(e))
    }
    finally {
      setBusy(false)
    }
  }

  const deny = async () => {
    setBusy(true)
    try {
      await deviceDenyAccount(userCode)
      onDenied()
    }
    catch (e) {
      onError(approveErrorCopy(e))
    }
    finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold text-text-primary">Authorize Dify CLI</h2>
        <p className="mt-2 text-sm text-text-secondary">
          Dify CLI (difyctl) is requesting access to your account.
          {' '}If you did not start this from your terminal, click Cancel.
        </p>
      </div>
      <div className="rounded-lg border border-components-panel-border bg-components-panel-bg px-4 py-3">
        {accountEmail && (
          <p className="text-sm text-text-secondary">
            Signed in as <span className="font-medium text-text-primary">{accountEmail}</span>
          </p>
        )}
        {defaultWorkspace && (
          <p className="mt-1 text-sm text-text-secondary">
            Default workspace: <span className="font-medium text-text-primary">{defaultWorkspace}</span>
          </p>
        )}
      </div>
      <div className="flex gap-3">
        <button
          onClick={approve}
          disabled={busy}
          className="flex-1 rounded-lg bg-components-button-primary-bg px-4 py-3 text-components-button-primary-text font-medium hover:bg-components-button-primary-bg-hover disabled:opacity-50"
        >
          Authorize
        </button>
        <button
          onClick={deny}
          disabled={busy}
          className="flex-1 rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-4 py-3 text-components-button-secondary-text font-medium hover:bg-components-button-secondary-bg-hover disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default AuthorizeAccount
