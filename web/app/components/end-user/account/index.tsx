'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { toast } from '@/app/notifications'
import { isAbortError } from '@/service/client-error'
import { isUnauthorizedError } from '@/service/http-error'
import { webAppQuery } from '@/service/webapp'
import { getWebAppAuthSessionSnapshot, subscribeWebAppAuthSession } from '@/service/webapp-auth'
import { getAvatarInitial } from '@/utils/avatar'
import ChangePasswordDialog from './change-password-dialog'
import EditAccountNameDialog from './edit-account-name-dialog'
import EmailChangeModal from './email-change-modal'

function AccountSession({ authSession }: { authSession: number }) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const [showEmailChange, setShowEmailChange] = useState(false)
  const profile = useQuery(
    webAppQuery.account.profile.get.queryOptions({
      queryKey: [...webAppQuery.account.profile.get.queryKey(), authSession],
      context: { authSession },
      meta: { errorToast: false },
      retry: false,
      gcTime: 0,
    }),
  )
  const features = useQuery(
    webAppQuery.systemFeatures.get.queryOptions({
      meta: { errorToast: false },
      retry: false,
      staleTime: Infinity,
    }),
  )
  const { error } = profile
  const reportedErrorRef = useRef<typeof error>(null)
  useEffect(() => {
    if (!error || error === reportedErrorRef.current || isAbortError(error)) return
    reportedErrorRef.current = error
    const message = isUnauthorizedError(error) ? undefined : error.message
    toast.error(message || t(($) => $['api.actionFailed'], { ns: 'common' }))
  }, [error, t])

  const account = profile.isError ? undefined : profile.data

  return (
    <div className="mx-auto w-full max-w-160 px-6 pt-12 pb-8">
      <h1 className="pt-2 pb-3 title-2xl-semi-bold text-text-primary">
        {t(($) => $['account.myAccount'], { ns: 'accountSettings' })}
      </h1>
      {profile.isPending ? (
        <LoadingPlaceholder className="py-8" />
      ) : account ? (
        <>
          <div className="mb-8 flex items-center rounded-xl bg-linear-to-r from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 p-6">
            <Avatar size="3xl" aria-hidden>
              <AvatarFallback>{getAvatarInitial(account.name)}</AvatarFallback>
              <AvatarImage src={account.avatar_url ?? undefined} alt="" />
            </Avatar>
            <div className="ms-4 min-w-0">
              <p className="system-xl-semibold wrap-anywhere text-text-primary">{account.name}</p>
              <p className="system-xs-regular wrap-anywhere text-text-tertiary">{account.email}</p>
            </div>
          </div>
          <div className="mb-8">
            <h2 className="system-sm-semibold text-text-secondary">
              {t(($) => $['account.name'], { ns: 'accountSettings' })}
            </h2>
            <div className="mt-2 flex w-full items-center justify-between gap-2">
              <div className="min-w-0 flex-1 rounded-lg bg-components-input-bg-normal p-2 system-sm-regular text-components-input-text-filled">
                <span className="ps-1 wrap-anywhere">{account.name}</span>
              </div>
              <EditAccountNameDialog name={account.name} authSession={authSession} />
            </div>
          </div>
          <div className="mb-8">
            <h2 className="system-sm-semibold text-text-secondary">
              {t(($) => $['account.email'], { ns: 'accountSettings' })}
            </h2>
            <div className="mt-2 flex w-full items-center justify-between gap-2">
              <div className="min-w-0 flex-1 rounded-lg bg-components-input-bg-normal p-2 system-sm-regular text-components-input-text-filled">
                <span className="ps-1 wrap-anywhere">{account.email}</span>
              </div>
              {features.data?.enable_change_email && (
                <Button
                  variant="tertiary"
                  className="cursor-pointer px-3"
                  onClick={() => setShowEmailChange(true)}
                >
                  {t(($) => $['operation.change'], { ns: 'common' })}
                </Button>
              )}
            </div>
          </div>
          {features.data?.enable_email_password_login && (
            <div className="mb-8 flex justify-between gap-2">
              <div>
                <h2 className="mb-1 system-sm-semibold text-text-secondary">
                  {t(($) => $['account.password'], { ns: 'accountSettings' })}
                </h2>
                <p className="mb-2 body-xs-regular text-text-tertiary">
                  {t(($) => $['account.passwordTip'], { ns: 'accountSettings' })}
                </p>
              </div>
              <ChangePasswordDialog
                isPasswordSet={account.is_password_set}
                authSession={authSession}
              />
            </div>
          )}
          {showEmailChange && (
            <EmailChangeModal
              email={account.email}
              authSession={authSession}
              onClose={() => setShowEmailChange(false)}
            />
          )}
        </>
      ) : null}
    </div>
  )
}

export default function Account() {
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    () => 0,
  )
  return <AccountSession key={authSession} authSession={authSession} />
}
