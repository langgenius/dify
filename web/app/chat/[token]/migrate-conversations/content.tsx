'use client'

import { queryOptions, useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import AppUnavailable from '@/app/components/base/app-unavailable'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import SignInConfirmation from '@/app/components/share/signin-confirmation'
import { useParams, useSearchParams } from '@/next/navigation'
import { getHttpErrorStatus } from '@/service/http-error'
import { useGetWebAppInfo } from '@/service/use-share'
import { webAppQuery } from '@/service/webapp'
import { getWebAppAuthSessionSnapshot, subscribeWebAppAuthSession } from '@/service/webapp-auth'
import { claimWebAppMigration, loadWebAppMigrationCandidates } from '@/service/webapp/migration'

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
  const currentSearch = searchParams.toString()
  const continueHref =
    searchParams.get('redirect_url') ||
    `/chat/${encodeURIComponent(token)}${currentSearch ? `?${currentSearch}` : ''}`
  const { data: appInfo, error } = useGetWebAppInfo()
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
  const candidates = useQuery(migrationCandidatesQueryOptions(authSession))
  const migration = useMutation({
    mutationFn: () => claimWebAppMigration(candidates.data || []),
    onSuccess: () => window.location.replace(continueHref),
  })
  useEffect(() => {
    if (candidates.isSuccess && candidates.data.length === 0) window.location.replace(continueHref)
  }, [candidates.data, candidates.isSuccess, continueHref])

  if (error || profile.isError || candidates.isError) {
    const status = getHttpErrorStatus(error)
    return (
      <AppUnavailable className="size-auto" code={status ?? 500} isUnknownReason={status !== 404} />
    )
  }

  if (!appInfo || profile.isPending || candidates.isPending || candidates.data.length === 0) {
    return <LoadingPlaceholder className="min-h-48" label={t(($) => $.loading, { ns: 'common' })} />
  }

  return (
    <SignInConfirmation
      key={token}
      accountName={profile.data.name}
      conversationCount={candidates.data.reduce(
        (total, candidate) => total + candidate.conversation_count,
        0,
      )}
      app={appInfo.site}
      continueHref={continueHref}
      deleteAvailable={false}
      isSubmitting={migration.isPending}
      actionError={migration.error?.message}
      onConfirm={(choice) => {
        if (choice === 'add') migration.mutate()
      }}
    />
  )
}
