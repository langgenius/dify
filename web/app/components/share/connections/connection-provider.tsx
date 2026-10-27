'use client'

import type {
  ConnectionConfigurationResponse,
  EndUserConnectionListResponse,
  EndUserConnectionResponse,
} from '@dify/contracts/api/web/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import type { WebAppEntryState } from '../webapp-entry'
import type { ConnectionsState } from './use-connections'
import type { FormSchema } from '@/app/components/base/form/types'
import type { WebAppAddress } from '@/service/webapp-address'
import { ORPCError } from '@orpc/client'
import {
  skipToken,
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useState, useSyncExternalStore } from 'react'
import { webAppQuery } from '@/service/webapp'
import { getWebAppAuthSessionSnapshot, subscribeWebAppAuthSession } from '@/service/webapp-auth'
import { useWebAppEntry } from '../webapp-entry'
import { getConnectionData } from './connection-data'
import useConnectionActions, { connectionDetailQueryKey } from './use-connection-actions'
import { ConnectionsContext } from './use-connections'

type Props = PropsWithChildren<{
  address: WebAppAddress
  conversationId?: string
  credentialSchemas?: Readonly<Record<string, FormSchema[]>>
  oauthCallbackOrigin?: string
}>

function ConnectionSession({
  address,
  conversationId,
  authSession,
  entry,
  credentialSchemas,
  oauthCallbackOrigin,
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
  const queryClient = useQueryClient()
  const configurationInput = { query: { conversation_id: conversationId } }
  const listInput = (cursor: string | undefined) => ({ query: { limit: 100, cursor } })
  const listKey = [
    'webapp',
    ...webAppQuery.connections.get.key({ type: 'infinite', input: listInput(undefined) }),
    address,
    authSession,
  ]
  const configurationKey = [
    'webapp',
    ...webAppQuery.connections.configuration.get.queryKey({ input: configurationInput }),
    address,
    authSession,
    parameters?.connection_revision,
  ]
  const list = useInfiniteQuery(
    webAppQuery.connections.get.infiniteOptions({
      input: enabled ? listInput : skipToken,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage, _pages, cursor, cursors) => {
        const next = lastPage.has_more ? lastPage.next_cursor : null
        // Repeated cursors must not fetch the same pages indefinitely.
        return next && next !== cursor && !cursors.includes(next) ? next : undefined
      },
      queryKey: listKey,
      context,
      staleTime: 0,
      gcTime: 0,
      retry: false,
    }),
  )
  const configuration = useQuery(
    webAppQuery.connections.configuration.get.queryOptions({
      input: enabled ? configurationInput : skipToken,
      queryKey: configurationKey,
      context,
      staleTime: 0,
      gcTime: 0,
      retry: false,
    }),
  )
  const [selectionOverrides, setSelectionOverrides] = useState<Record<string, string | null>>({})
  const [confirmedIds, setConfirmedIds] = useState<string[]>([])
  const confirmed = useQueries({
    queries: confirmedIds.map((connectionId) =>
      webAppQuery.connections.byConnectionId.get.queryOptions({
        input: enabled ? { params: { connection_id: connectionId } } : skipToken,
        queryKey: connectionDetailQueryKey(address, authSession, connectionId),
        context,
        staleTime: Infinity,
        refetchOnWindowFocus: 'always',
        gcTime: 0,
        retry: false,
      }),
    ),
  })
  const listedConnections = list.data?.pages.flatMap((page) => page.data) ?? []
  const isMissingConnection = (error: unknown) => error instanceof ORPCError && error.status === 404
  const unavailableIds = new Set(
    confirmedIds.filter((_, index) => isMissingConnection(confirmed[index]?.error)),
  )
  const connectionsById = new Map<string, EndUserConnectionResponse>()
  // Successful writes can return connections beyond the currently loaded pages.
  for (const connection of [
    ...confirmed.flatMap((result) => (result.data && !result.error ? [result.data] : [])),
    ...listedConnections,
  ]) {
    if (unavailableIds.has(connection.id)) continue
    const previous = connectionsById.get(connection.id)
    if (!previous || previous.updated_at <= connection.updated_at)
      connectionsById.set(connection.id, connection)
  }
  const connections = enabled ? [...connectionsById.values()] : []
  const lastPage = list.data?.pages.at(-1)
  const invalidCursor =
    lastPage?.has_more &&
    (!lastPage.next_cursor || list.data?.pageParams.includes(lastPage.next_cursor))
  const data = getConnectionData({
    requirements,
    connections,
    configuration:
      enabled && configuration.data
        ? {
            connections: Object.fromEntries(
              Object.entries(configuration.data.connections).map(([nodeId, connection]) => [
                nodeId,
                connection && unavailableIds.has(connection.id) ? null : connection,
              ]),
            ),
          }
        : undefined,
    selectionOverrides,
    allConnectionsLoaded: lastPage?.has_more === false,
  })
  const accountUnavailable = entry && 'account' in entry && entry.account === 'unavailable'
  const error =
    list.error ??
    configuration.error ??
    confirmed.find((result) => result.error && !isMissingConnection(result.error))?.error ??
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

  const services = data.services.map((service) => {
    const requirement = requirements.find((item) => item.node_id === service.id)
    return {
      ...service,
      credentialSchemas: requirement ? credentialSchemas?.[requirement.provider] : undefined,
    }
  })
  const refreshConnections = async () => {
    await Promise.all([list.refetch(), configuration.refetch()])
  }
  const actions = useConnectionActions({
    address,
    authSession,
    connectionRevision: parameters?.connection_revision,
    requirements,
    services,
    disabled: status !== 'ready',
    oauthCallbackOrigin,
    refreshConnections,
    onSaved: (nodeId, connection) => {
      void queryClient.cancelQueries({ queryKey: listKey, exact: true })
      queryClient.setQueryData(
        connectionDetailQueryKey(address, authSession, connection.id),
        connection,
      )
      setConfirmedIds((current) =>
        current.includes(connection.id) ? current : [...current, connection.id],
      )
      setSelectionOverrides((current) => ({ ...current, [nodeId]: connection.id }))
    },
    onRemoved: (connectionId) => {
      void queryClient.cancelQueries({ queryKey: listKey, exact: true })
      void queryClient.cancelQueries({ queryKey: configurationKey, exact: true })
      queryClient.setQueryData<InfiniteData<EndUserConnectionListResponse>>(
        listKey,
        (current) =>
          current && {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              data: page.data.filter((connection) => connection.id !== connectionId),
            })),
          },
      )
      queryClient.setQueryData<ConnectionConfigurationResponse>(
        configurationKey,
        (current) =>
          current && {
            connections: Object.fromEntries(
              Object.entries(current.connections).map(([nodeId, connection]) => [
                nodeId,
                connection?.id === connectionId ? null : connection,
              ]),
            ),
          },
      )
      setConfirmedIds((current) => current.filter((id) => id !== connectionId))
      queryClient.removeQueries({
        queryKey: connectionDetailQueryKey(address, authSession, connectionId),
        exact: true,
      })
      setSelectionOverrides((current) => ({
        ...current,
        ...Object.fromEntries(
          Object.entries(data.selections)
            .filter(([, id]) => id === connectionId)
            .map(([nodeId]) => [nodeId, null]),
        ),
      }))
    },
  })

  const onConnectionChange = (nodeId: string, connectionId: string | null) => {
    if (status !== 'ready' || actions.isMutating) return
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
        ...actions,
        services,
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
          for (const connectionId of confirmedIds)
            void queryClient.invalidateQueries({
              queryKey: connectionDetailQueryKey(address, authSession, connectionId),
              exact: true,
            })
        },
      }}
    >
      {children}
    </ConnectionsContext>
  )
}

export function WebAppConnectionsProvider({
  address,
  conversationId,
  credentialSchemas,
  oauthCallbackOrigin,
  children,
}: Props) {
  const entry = useWebAppEntry()
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    () => 0,
  )
  const connectionRevision =
    entry && 'parameters' in entry ? entry.parameters.connection_revision : null
  const sessionKey = JSON.stringify([
    address.kind,
    address.code,
    authSession,
    connectionRevision,
    conversationId,
  ])

  return (
    <ConnectionSession
      key={sessionKey}
      address={address}
      conversationId={conversationId}
      authSession={authSession}
      entry={entry}
      credentialSchemas={credentialSchemas}
      oauthCallbackOrigin={oauthCallbackOrigin}
    >
      {children}
    </ConnectionSession>
  )
}
