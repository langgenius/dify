'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { webAppQuery } from '@/service/webapp'
import { getWebAppAuthSessionSnapshot, subscribeWebAppAuthSession } from '@/service/webapp-auth'

type BuildAppLinkProps = {
  variant?: 'sidebar' | 'footer'
}

export default function BuildAppLink({ variant = 'sidebar' }: BuildAppLinkProps) {
  const { t } = useTranslation(['app'])
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    () => 0,
  )
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
  const content = (
    <>
      {variant === 'sidebar' && <span aria-hidden className="i-ri-add-line size-4 shrink-0" />}
      <span className="min-w-0 flex-1 text-start wrap-anywhere">
        {t(($) => $['endUser.buildYourOwnApp'], { ns: 'app' })}
      </span>
      <span aria-hidden className="i-ri-arrow-right-up-line size-4 shrink-0" />
    </>
  )

  if (profile.isPending || !features.data) return null

  const href = `${features.data.console_web_url}${profile.data?.has_tenant ? '/' : '/create-workspace'}`

  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 system-md-medium text-components-main-nav-nav-button-text hover:bg-components-main-nav-nav-button-bg-hover',
        variant === 'footer' ? 'min-h-7 min-w-0 py-1' : 'min-h-9 w-full py-2',
        'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
      )}
    >
      {content}
    </Link>
  )
}
