'use client'

import type { FC } from 'react'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deviceApproveAccount, deviceDenyAccount } from '@/service/device-flow'
import { approveErrorCopy } from '../utils/error-copy'

type Props = {
  userCode: string
  accountEmail?: string
  accountName?: string
  accountAvatarUrl?: string | null
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
  userCode,
  accountEmail,
  accountName,
  accountAvatarUrl,
  defaultWorkspace,
  onApproved,
  onDenied,
  onError,
}) => {
  const { t } = useTranslation('deviceFlow')
  const [busy, setBusy] = useState(false)

  const approve = async () => {
    setBusy(true)
    try {
      await deviceApproveAccount(userCode)
      onApproved()
    } catch (e) {
      onError(approveErrorCopy(e, t))
    } finally {
      setBusy(false)
    }
  }

  const deny = async () => {
    setBusy(true)
    try {
      await deviceDenyAccount(userCode)
      onDenied()
    } catch (e) {
      onError(approveErrorCopy(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl font-semibold text-text-primary">
          {t(($) => $['authorize.title'])}
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          {t(($) => $['authorize.accountSubtitle'])}
        </p>
      </div>
      <div className="flex items-center gap-2.5 rounded-lg bg-background-section-burn px-3 py-2.5">
        <Avatar
          size="md"
          avatar={accountAvatarUrl ?? null}
          name={accountName || accountEmail || ''}
        />
        <div>
          {accountName && <p className="text-sm font-semibold text-text-primary">{accountName}</p>}
          {accountEmail && <p className="text-xs text-text-secondary">{accountEmail}</p>}
        </div>
      </div>
      {defaultWorkspace && (
        <div className="rounded-lg bg-background-section-burn px-3 py-2 text-sm text-text-secondary">
          {t(($) => $['authorize.workspace'])}{' '}
          <span className="font-semibold text-text-primary">{defaultWorkspace}</span>
        </div>
      )}
      <div className="flex gap-3">
        <Button variant="primary" size="large" className="flex-1" onClick={approve} disabled={busy}>
          {t(($) => $['authorize.approve'])}
        </Button>
        <Button variant="secondary" size="large" className="flex-1" onClick={deny} disabled={busy}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </Button>
      </div>
    </div>
  )
}

export default AuthorizeAccount
