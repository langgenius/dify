'use client'

import type { PropsWithChildren } from 'react'
import type { WebAppEntryState } from '../webapp-entry'
import type { ConnectionsState } from './use-connections'
import type { WebAppAddress } from '@/service/webapp-address'
import { skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useState, useSyncExternalStore } from 'react'
import { webAppQuery } from '@/service/webapp'
import { getWebAppAuthSessionSnapshot, subscribeWebAppAuthSession } from '@/service/webapp-auth'
import { useWebAppEntry } from '../webapp-entry'
import { getConnectionData } from './connection-data'
import { ConnectionsContext } from './use-connections'

type Props = PropsWithChildren<{
  address: WebAppAddress
  conversationId?: string
}>

function ConnectionSession({
  address,
  conversationId,
  authSession,
  entry,
  children,
}: Props & { authSession: number; entry: WebAppEntryState | null }) {
  const parameters = entry && 'parameters' in entry ? entry.parameters : null
  const requirements = parameters?.connection_requirements ?? []
  const isActive = address.kind === 'default' && requirements.length > 0
  const accountReady =
    entry &&
    'account' in entry &&
    (entry.account === 'authenticated' ||
      (entry.account === 'anonymous' && parameters?.allow_anonymous_end_user_auth))
  const enabled = Boolean(isActive && accountReady)
  const context = { address, authSession, silent: true }
  const configurationInput = { query: { conversation_id: conversationId } }
  const listInput = (cursor: string | undefined) => ({ query: { limit: 100, cursor } })
  const list = useInfiniteQuery(
    webAppQuery.connections.get.infiniteOptions({
      input: enabled ? listInput : skipToken,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage, _pages, cursor, cursors) => {
        const next = lastPage.has_more ? lastPage.next_cursor : null
        // Repeated cursors must not fetch the same pages indefinitely.
        return next && next !== cursor && !cursors.includes(next) ? next : undefined
      },
      queryKey: [
        'webapp',
        ...webAppQuery.connections.get.key({ type: 'infinite', input: listInput(undefined) }),
        address,
        authSession,
      ],
      context,
      staleTime: 0,
      gcTime: 0,
      retry: false,
    }),
  )
  const configuration = useQuery(
    webAppQuery.connections.configuration.get.queryOptions({
      input: enabled ? configurationInput : skipToken,
      queryKey: [
        'webapp',
        ...webAppQuery.connections.configuration.get.queryKey({ input: configurationInput }),
        address,
        authSession,
        parameters?.workflow_id,
      ],
      context,
      staleTime: 0,
      gcTime: 0,
      retry: false,
    }),
  )
  const [selectionOverrides, setSelectionOverrides] = useState<Record<string, string | null>>({})
  const connections = enabled ? (list.data?.pages.flatMap((page) => page.data) ?? []) : []
  const lastPage = list.data?.pages.at(-1)
  const invalidCursor =
    lastPage?.has_more &&
    (!lastPage.next_cursor || list.data?.pageParams.includes(lastPage.next_cursor))
  const data = getConnectionData({
    requirements,
    connections,
    configuration: enabled ? configuration.data : undefined,
    selectionOverrides,
    allConnectionsLoaded: lastPage?.has_more === false,
  })
  const accountUnavailable = entry && 'account' in entry && entry.account === 'unavailable'
  const error =
    list.error ??
    configuration.error ??
    (invalidCursor
      ? new Error('The connection list returned an invalid pagination cursor.')
      : null) ??
    (accountUnavailable ? new Error('The account login status is unavailable.') : null)
  const status: ConnectionsState['status'] =
    !entry || entry.status === 'loading'
      ? 'loading'
      : !isActive
        ? 'inactive'
        : entry && 'account' in entry && entry.account === 'anonymous' && !accountReady
          ? 'sign-in-required'
          : error
            ? 'error'
            : !enabled || list.isPending || configuration.isPending
              ? 'loading'
              : 'ready'

  const onConnectionChange = (nodeId: string, connectionId: string | null) => {
    if (status !== 'ready') return
    const sourceId = data.sourceNodeByNodeId[nodeId]
    if (sourceId === undefined) return
    const service = data.services.find((item) => item.id === sourceId)
    if (!service) return
    if (
      connectionId !== null &&
      !service.availableConnections.some(
        (item) => item.id === connectionId && item.status === 'active',
      )
    )
      return
    setSelectionOverrides((current) => ({ ...current, [sourceId]: connectionId }))
  }

  return (
    <ConnectionsContext
      value={{
        ...data,
        status,
        error,
        onConnectionChange,
        hasMoreConnections: enabled && list.hasNextPage,
        isFetchingMoreConnections: list.isFetchingNextPage,
        loadMoreConnections: () => {
          if (enabled && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage()
        },
        retry: () => {
          if (!enabled) return
          if (list.isFetchNextPageError) void list.fetchNextPage()
          else void list.refetch()
          void configuration.refetch()
        },
      }}
    >
      {children}
    </ConnectionsContext>
  )
}

export function WebAppConnectionsProvider({ address, conversationId, children }: Props) {
  const entry = useWebAppEntry()
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    () => 0,
  )
  const workflowId = entry && 'parameters' in entry ? entry.parameters.workflow_id : null
  const sessionKey = JSON.stringify([
    address.kind,
    address.code,
    authSession,
    workflowId,
    conversationId,
  ])

  return (
    <ConnectionSession
      key={sessionKey}
      address={address}
      conversationId={conversationId}
      authSession={authSession}
      entry={entry}
    >
      {children}
    </ConnectionSession>
  )
}
