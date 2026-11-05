'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { webAppQuery } from '@/service/webapp'
import { getWebAppAuthSessionSnapshot, subscribeWebAppAuthSession } from '@/service/webapp-auth'

export default function BuildAppLink() {
  const { t } = useTranslation(['app'])
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
      gcTime: 0,
    }),
  )
  const className =
    'flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-2 system-md-medium text-components-main-nav-nav-button-text hover:bg-components-main-nav-nav-button-bg-hover'
  const content = (
    <>
      <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
      <span className="min-w-0 flex-1 text-start wrap-anywhere">
        {t(($) => $['endUser.buildYourOwnApp'], { ns: 'app' })}
      </span>
      <span aria-hidden className="i-ri-arrow-right-up-line size-4 shrink-0" />
    </>
  )

  return profile.isPending ? null : (
    <Link
      href={profile.data?.has_tenant ? '/' : '/create-workspace'}
      className={cn(
        className,
        'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
      )}
    >
      {content}
    </Link>
  )
}
