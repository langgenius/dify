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
import useConnectionPreflight from './use-connection-preflight'
import { ConnectionsContext } from './use-connections'

type Props = PropsWithChildren<{
  address: WebAppAddress
  conversationId?: string
  selectionSession?: number
  oauthCallbackOrigin?: string
}>

type ConnectionDraft = {
  scope: string
  session: object
  selectionOverrides: Record<string, string | null>
  confirmedIds: string[]
  validationRevision: number
}

function createDraft(scope: string, validationRevision = 0): ConnectionDraft {
  return { scope, session: {}, selectionOverrides: {}, confirmedIds: [], validationRevision }
}

function ConnectionSession({
  address,
  conversationId,
  selectionSession = 0,
  authSession,
  entry,
  oauthCallbackOrigin,
  children,
}: Props & { authSession: number; entry: WebAppEntryState | null }) {
  const parameters = entry && 'parameters' in entry ? entry.parameters : null
  const requirements = parameters?.connection_requirements ?? []
  const requiresConnections =
    address.kind === 'default' && Boolean(parameters?.requires_end_user_connections)
  const isActive = requiresConnections && requirements.length > 0
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
    selectionSession,
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
  const scope = JSON.stringify([
    address.kind,
    address.code,
    authSession,
    parameters?.connection_revision,
    conversationId,
    selectionSession,
  ])
  const [storedDraft, setStoredDraft] = useState(() => createDraft(scope))
  const draft =
    storedDraft.scope === scope
      ? storedDraft
      : createDraft(scope, storedDraft.validationRevision + 1)
  if (draft !== storedDraft) setStoredDraft(draft)
  const { selectionOverrides, confirmedIds, validationRevision, session } = draft
  const updateDraft = (update: (current: ConnectionDraft) => ConnectionDraft) =>
    setStoredDraft((current) => (current.session === session ? update(current) : current))
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

  const services = data.services
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
      updateDraft((current) => ({
        ...current,
        validationRevision: current.validationRevision + 1,
        confirmedIds: current.confirmedIds.includes(connection.id)
          ? current.confirmedIds
          : [...current.confirmedIds, connection.id],
        selectionOverrides: { ...current.selectionOverrides, [nodeId]: connection.id },
      }))
      void queryClient.cancelQueries({ queryKey: listKey, exact: true })
      queryClient.setQueryData(
        connectionDetailQueryKey(address, authSession, connection.id),
        connection,
      )
    },
    onRemoved: (connectionId) => {
      updateDraft((current) => ({
        ...current,
        validationRevision: current.validationRevision + 1,
        confirmedIds: current.confirmedIds.filter((id) => id !== connectionId),
        selectionOverrides: {
          ...current.selectionOverrides,
          ...Object.fromEntries(
            Object.entries(data.selections)
              .filter(([, id]) => id === connectionId)
              .map(([nodeId]) => [nodeId, null]),
          ),
        },
      }))
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
      queryClient.removeQueries({
        queryKey: connectionDetailQueryKey(address, authSession, connectionId),
        exact: true,
      })
    },
  })

  const validation = useConnectionPreflight({
    address,
    authSession,
    conversationId,
    connectionRevision: parameters?.connection_revision,
    requirements,
    selections: data.selections,
    selectedConnections: requirements.map(({ node_id }) => {
      const selectedId = data.selections[node_id]
      if (!selectedId) return null
      const configured = configuration.data?.connections[node_id]
      return connectionsById.get(selectedId) ?? (configured?.id === selectedId ? configured : null)
    }),
    validationRevision,
    requiresConnections,
    canRunWithoutConnections: entry?.canRun ?? false,
    enabled:
      status === 'ready' &&
      !list.isRefetching &&
      !configuration.isFetching &&
      !confirmed.some((result) => result.isFetching) &&
      !actions.isMutating,
  })
  const preflightByNodeId = new Map(
    validation.preflight.response?.connections.map((connection) => [
      connection.node_id,
      connection,
    ]),
  )
  const checkedServices = services.map((service) => ({
    ...service,
    preflight: preflightByNodeId.get(service.id),
  }))

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
    updateDraft((current) => ({
      ...current,
      selectionOverrides: { ...current.selectionOverrides, [sourceId]: connectionId },
    }))
  }

  return (
    <ConnectionsContext
      value={{
        ...data,
        ...actions,
        ...validation,
        services: checkedServices,
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
  selectionSession,
  oauthCallbackOrigin,
  children,
}: Props) {
  const entry = useWebAppEntry()
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    () => 0,
  )

  return (
    <ConnectionSession
      key={JSON.stringify([address.kind, address.code, authSession])}
      address={address}
      conversationId={conversationId}
      selectionSession={selectionSession}
      authSession={authSession}
      entry={entry}
      oauthCallbackOrigin={oauthCallbackOrigin}
    >
      {children}
    </ConnectionSession>
  )
}
