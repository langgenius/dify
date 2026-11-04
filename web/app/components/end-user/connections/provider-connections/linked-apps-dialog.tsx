'use client'

import type { ConsumerAppResponse } from '@dify/contracts/api/web/types.gen'
import type { EndUserConnection } from '../model'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useId, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { getEndUserAppHref } from '@/app/components/end-user/app-link'
import Link from '@/next/link'
import { webAppQuery } from '@/service/webapp'
import { getWebAppAuthSessionSnapshot, subscribeWebAppAuthSession } from '@/service/webapp-auth'

type Props = {
  connection: EndUserConnection
  connectionLabelId: string
}

function LinkedAppItem({ app }: { app: ConsumerAppResponse }) {
  const nameId = useId()
  const descriptionId = useId()

  return (
    <li className="h-16 border-b border-divider-subtle">
      <Link
        href={getEndUserAppHref(app)}
        aria-labelledby={nameId}
        aria-describedby={descriptionId}
        className="-ms-2 flex h-full items-center gap-3 rounded-md py-3 ps-2 hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden focus-visible:ring-inset"
      >
        <AppIcon size="small" icon={app} decorative />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span id={nameId} className="truncate system-md-semibold text-text-secondary">
            {app.name}
          </span>
          <span id={descriptionId} className="truncate system-xs-regular text-text-tertiary">
            {app.description}
          </span>
        </div>
        <span
          className="flex size-6 shrink-0 items-center justify-center text-text-tertiary"
          aria-hidden="true"
        >
          <span className="i-ri-arrow-right-up-line size-4" />
        </span>
      </Link>
    </li>
  )
}

function LinkedAppsContent({ connection }: { connection: EndUserConnection }) {
  const { t } = useTranslation(['app', 'common'])
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    () => 0,
  )
  const input = (cursor: string | undefined) => ({
    params: { connection_key: connection.key },
    query: { limit: 20, cursor },
  })
  const apps = useInfiniteQuery(
    webAppQuery.me.connections.byConnectionKey.apps.get.infiniteOptions({
      input,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page, _pages, cursor, cursors) => {
        const next = page.has_more ? page.next_cursor : null
        return next && next !== cursor && !cursors.includes(next) ? next : undefined
      },
      queryKey: [
        ...webAppQuery.me.connections.byConnectionKey.apps.get.key({
          type: 'infinite',
          input: input(undefined),
        }),
        authSession,
      ],
      context: { authSession, silent: true },
      retry: false,
      gcTime: 0,
    }),
  )
  const linkedApps = Array.from(
    new Map(
      apps.data?.pages.flatMap((page) => page.data.map((app) => [app.id, app] as const)),
    ).values(),
  )

  return (
    <>
      {apps.isPending && <p role="status">{t(($) => $.loading, { ns: 'common' })}</p>}
      {apps.isError && (
        <div className="space-y-2">
          <p role="alert" className="system-sm-regular text-text-destructive">
            {apps.error.message || t(($) => $['api.actionFailed'], { ns: 'common' })}
          </p>
          <Button onClick={() => apps.refetch()}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
      {linkedApps.length > 0 && (
        <ul className="-ms-2 ps-2">
          {linkedApps.map((app) => (
            <LinkedAppItem key={app.id} app={app} />
          ))}
        </ul>
      )}
      {apps.isSuccess && linkedApps.length === 0 && (
        <p className="system-sm-regular text-text-tertiary">
          {t(($) => $['endUser.noLinkedApps'], { ns: 'app' })}
        </p>
      )}
      {apps.hasNextPage && (
        <Button loading={apps.isFetchingNextPage} onClick={() => apps.fetchNextPage()}>
          {t(($) => $['operation.viewMore'], { ns: 'common' })}
        </Button>
      )}
    </>
  )
}

export default function LinkedAppsDialog({ connection, connectionLabelId }: Props) {
  const { t } = useTranslation(['app', 'common'])

  return (
    <Dialog>
      <DialogTrigger
        aria-describedby={connectionLabelId}
        className="inline-flex min-h-6 items-center rounded-md system-xs-medium text-text-accent hover:underline"
      >
        {t(($) => $['endUser.linkedAppCount'], { ns: 'app', count: connection.webapps_count })}
      </DialogTrigger>
      <DialogContent className="w-130">
        <DialogHeader>
          <DialogTitle>
            {t(($) => $['endUser.linkedAppsTitle'], { ns: 'app', count: connection.webapps_count })}
          </DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody className="max-h-94">
          <LinkedAppsContent connection={connection} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
