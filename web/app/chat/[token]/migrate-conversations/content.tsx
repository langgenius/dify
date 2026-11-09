'use client'

import type { MigrationDataChoice } from '@/app/components/share/signin-confirmation'
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import AppUnavailable from '@/app/components/base/app-unavailable'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import SignInConfirmation from '@/app/components/share/signin-confirmation'
import { PASSPORT_LOCAL_STORAGE_NAME } from '@/config'
import { useParams, useSearchParams } from '@/next/navigation'
import { getHttpErrorStatus } from '@/service/http-error'
import { useGetWebAppInfo } from '@/service/use-share'
import { webAppClient, webAppQuery } from '@/service/webapp'
import {
  getAnonymousWebAppPassport,
  getWebAppAuthSessionSnapshot,
  removeAnonymousWebAppPassport,
  subscribeWebAppAuthSession,
  webAppLogout,
} from '@/service/webapp-auth'
import { beginWebAppAccountLogin, resolveWebAppAccountReturn } from '@/service/webapp/login'
import { claimWebAppMigration, loadWebAppMigrationCandidates } from '@/service/webapp/migration'
import { basePath } from '@/utils/var'

const migrationCandidatesQueryOptions = (authSession: number) =>
  queryOptions({
    queryKey: ['webapp', 'migration', 'candidates', authSession],
    queryFn: ({ signal }) => loadWebAppMigrationCandidates(signal),
    retry: false,
  })

export default function MigrateConversationsContent() {
  const { t } = useTranslation(['common'])
  const { token } = useParams<{ token: string }>()
  const searchParams = useSearchParams()
  const fallbackParams = new URLSearchParams(searchParams.toString())
  fallbackParams.delete('redirect_url')
  const currentSearch = fallbackParams.toString()
  const continueHref =
    resolveWebAppAccountReturn(searchParams.get('redirect_url'))?.url ||
    `${basePath}/chat/${encodeURIComponent(token)}${currentSearch ? `?${currentSearch}` : ''}`
  const { data: appInfo, error } = useGetWebAppInfo()
  const supportsMigration =
    appInfo?.mode === 'workflow' || appInfo?.mode === 'advanced-chat' || appInfo?.mode === 'chat'
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    () => 0,
  )
  const profile = useQuery(
    webAppQuery.account.profile.get.queryOptions({
      queryKey: [...webAppQuery.account.profile.get.queryKey(), authSession],
      context: { authSession, silent: true },
      retry: false,
    }),
  )
  const candidates = useQuery({
    ...migrationCandidatesQueryOptions(authSession),
    enabled: supportsMigration,
  })
  const migration = useMutation({
    mutationFn: async (choice: MigrationDataChoice) => {
      if (choice === 'continue') return
      const selectedCandidates = candidates.data || []
      if (choice === 'delete') {
        if (supportsMigration) {
          for (const candidate of selectedCandidates)
            removeAnonymousWebAppPassport(candidate.credential)
        } else {
          const passport = getAnonymousWebAppPassport({ kind: 'default', code: token })
          if (passport)
            removeAnonymousWebAppPassport({ key: PASSPORT_LOCAL_STORAGE_NAME(token), passport })
        }
        return
      }
      if (supportsMigration) await claimWebAppMigration(selectedCandidates)
    },
    onSuccess: () => window.location.replace(continueHref),
  })
  const switchAccount = useMutation({
    mutationFn: async () => {
      const address = { kind: 'default', code: token } as const
      const parameters = await webAppClient.parameters.get(undefined, {
        context: { address, silent: true },
      })
      if (!parameters.account_login_url)
        throw new Error(t(($) => $['api.actionFailed'], { ns: 'common' }))
      await webAppLogout(address)
      const target = await beginWebAppAccountLogin(parameters.account_login_url, continueHref)
      const signInUrl = new URL(target)
      signInUrl.searchParams.set('switch_account', '1')
      window.location.assign(signInUrl.href)
    },
  })
  useEffect(() => {
    if (supportsMigration && candidates.isSuccess && candidates.data.length === 0)
      window.location.replace(continueHref)
  }, [supportsMigration, candidates.data, candidates.isSuccess, continueHref])

  if (switchAccount.isPending) {
    return <LoadingPlaceholder className="min-h-48" label={t(($) => $.loading, { ns: 'common' })} />
  }

  if (error || profile.isError || (supportsMigration && candidates.isError)) {
    const status = getHttpErrorStatus(error)
    return (
      <AppUnavailable className="size-auto" code={status ?? 500} isUnknownReason={status !== 404} />
    )
  }

  if (
    !appInfo ||
    profile.isPending ||
    (supportsMigration && (candidates.isPending || candidates.data?.length === 0))
  ) {
    return <LoadingPlaceholder className="min-h-48" label={t(($) => $.loading, { ns: 'common' })} />
  }

  return (
    <SignInConfirmation
      key={`${token}:${appInfo.mode}`}
      accountName={profile.data.name}
      supportsMigration={supportsMigration}
      app={appInfo.site}
      continueHref={continueHref}
      isSubmitting={migration.isPending}
      actionError={migration.error?.message || switchAccount.error?.message}
      onSwitchAccount={() => switchAccount.mutate()}
      onConfirm={(choice) => migration.mutate(choice)}
    />
  )
}
