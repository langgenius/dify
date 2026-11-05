'use client'

import type {
  InstalledAppParametersResponse,
  InstalledConnectionPreflightPayload,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import type { PropsWithChildren } from 'react'
import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { consoleQuery } from '@/service/console'
import { InstalledAppConnectionsContext } from './use-installed-app-connections'

type Props = PropsWithChildren<{
  installedAppId: string
  conversationId?: string
}>

function useConnectionData({
  installedAppId,
  conversationId,
  parameters,
  parametersError,
  reloadParameters,
}: Omit<Props, 'children'> & {
  parameters?: InstalledAppParametersResponse
  parametersError: Error | null
  reloadParameters: () => void
}) {
  const queryClient = useQueryClient()
  const activeSessionRef = useRef(false)
  useEffect(() => {
    activeSessionRef.current = true
    return () => {
      activeSessionRef.current = false
    }
  }, [])
  const params = { installed_app_id: installedAppId }
  const api = consoleQuery.installedApps.byInstalledAppId.connections
  const requirements = parameters?.connection_requirements ?? []
  const required = Boolean(parameters?.requires_end_user_connections)
  const revision = parameters?.connection_revision
  const enabled = required && requirements.length > 0 && !!revision
  const configurationInput = { params, query: { conversation_id: conversationId } }
  const configurationKey = [
    ...api.configuration.get.queryKey({ input: configurationInput }),
    revision,
  ]
  const configuration = useQuery(
    api.configuration.get.queryOptions({
      input: enabled ? configurationInput : skipToken,
      queryKey: configurationKey,
      context: { silent: true },
      retry: false,
    }),
  )
  const list = useInfiniteQuery(
    api.get.infiniteOptions({
      input: enabled
        ? (cursor: string | undefined) => ({ params, query: { limit: 100, cursor } })
        : skipToken,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page, _pages, cursor, cursors) => {
        const next = page.has_more ? page.next_cursor : null
        return next && next !== cursor && !cursors.includes(next) ? next : undefined
      },
      context: { silent: true },
      retry: false,
    }),
  )
  const { hasNextPage, isFetching, isError, fetchNextPage } = list
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError) void fetchNextPage()
  }, [hasNextPage, isFetching, isError, fetchNextPage])
  const credentials = list.data?.pages.flatMap((page) => page.data) ?? []
  const selections: Record<string, string | null> = Object.fromEntries(
    requirements.map(({ node_id }) => [
      node_id,
      configuration.data?.connections[node_id]?.id ?? null,
    ]),
  )
  const body: InstalledConnectionPreflightPayload | null = revision
    ? {
        connection_revision: revision,
        connections: selections,
        ...(conversationId ? { conversation_id: conversationId } : {}),
      }
    : null
  const save = useMutation(
    api.configuration.put.mutationOptions({
      context: { silent: true },
      onSuccess: (result) => {
        queryClient.setQueryData(configurationKey, result)
      },
    }),
  )
  const preflightInput = body ? { params, body } : skipToken
  const check = useQuery(
    api.preflight.post.queryOptions({
      input: preflightInput,
      queryKey: [
        ...api.preflight.post.queryKey({ input: preflightInput }),
        configuration.dataUpdatedAt,
      ],
      enabled:
        enabled &&
        configuration.isSuccess &&
        !configuration.isFetching &&
        list.isSuccess &&
        !list.hasNextPage &&
        !save.isPending,
      context: { silent: true },
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
      gcTime: 0,
    }),
  )
  const checking = check.isFetching
  const preflight = !save.isPending && !checking && !check.error ? (check.data ?? null) : null
  const ready =
    preflight?.ready === true &&
    preflight.connections.length === requirements.length &&
    requirements.every(({ node_id }) =>
      preflight.connections.some(
        (item) =>
          item.node_id === node_id &&
          item.status === 'connected' &&
          !!selections[node_id] &&
          item.connection_id === selections[node_id],
      ),
    )
  const error = parametersError ?? configuration.error ?? list.error ?? save.error ?? check.error
  let status: 'inactive' | 'loading' | 'error' | 'ready'
  if (error) status = 'error'
  else if (!parameters) status = 'loading'
  else if (!required) status = 'inactive'
  else if (!enabled || configuration.isPending || list.isPending || list.hasNextPage)
    status = 'loading'
  else status = 'ready'
  const canConfirm =
    status === 'ready' &&
    ready &&
    !save.isPending &&
    !checking &&
    !configuration.isFetching &&
    !list.isFetching
  const canRun =
    status === 'inactive' || (canConfirm && !configuration.data?.reauthorization_required)
  return {
    installedAppId,
    status,
    error,
    canRun,
    canConfirm,
    confirmSelection: async () => {
      if (!body || !canConfirm) return false
      try {
        await save.mutateAsync({ params, body })
        return true
      } catch {
        return false
      }
    },
    runConfiguration: canRun && required && body ? body : null,
    requirements,
    credentials,
    preflight,
    selections,
    isMutating: save.isPending || list.isFetching,
    checking,
    warningCount: requirements.filter(
      ({ node_id }) =>
        !selections[node_id] ||
        preflight?.connections.some(
          (item) => item.node_id === node_id && item.status !== 'connected',
        ),
    ).length,
    onSelect: async (nodeId: string, credentialId: string) => {
      if (!body || save.isPending || configuration.isFetching || status !== 'ready') return
      const requirement = requirements.find((item) => item.node_id === nodeId)
      let credential = credentials.find((item) => item.id === credentialId)
      if (!credential) {
        let refreshed = await list.refetch()
        while (refreshed.data && !refreshed.isError && activeSessionRef.current) {
          const lastPage = refreshed.data.pages.at(-1)
          const nextCursor = lastPage?.has_more ? lastPage.next_cursor : null
          if (!nextCursor || refreshed.data.pageParams.includes(nextCursor)) break
          refreshed = await list.fetchNextPage()
        }
        if (!activeSessionRef.current || refreshed.isError) return
        credential = refreshed.data?.pages
          .flatMap((page) => page.data)
          .find((item) => item.id === credentialId)
      }
      if (
        !requirement ||
        !credential ||
        credential.provider !== requirement.provider ||
        !requirement.allowed_credential_types.includes(credential.credential_type)
      )
        return
      save.mutate({
        params,
        body: { ...body, connections: { ...selections, [nodeId]: credentialId } },
      })
    },
    retry: () => {
      save.reset()
      reloadParameters()
      if (enabled) {
        void configuration.refetch()
        void list.refetch()
        void check.refetch()
      }
    },
  }
}

export type InstalledAppConnectionsState = ReturnType<typeof useConnectionData>

function ConnectionSession({
  children,
  ...props
}: Props & Parameters<typeof useConnectionData>[0]) {
  const state = useConnectionData(props)
  return <InstalledAppConnectionsContext value={state}>{children}</InstalledAppConnectionsContext>
}

export function InstalledAppConnectionsProvider({
  installedAppId,
  conversationId,
  children,
}: Props) {
  const parameters = useQuery(
    consoleQuery.installedApps.byInstalledAppId.parameters.get.queryOptions({
      input: { params: { installed_app_id: installedAppId } },
    }),
  )
  return (
    <ConnectionSession
      key={`${installedAppId}:${conversationId ?? ''}:${parameters.data?.connection_revision ?? ''}`}
      installedAppId={installedAppId}
      conversationId={conversationId}
      parameters={parameters.data}
      parametersError={parameters.error}
      reloadParameters={() => {
        void parameters.refetch()
      }}
    >
      {children}
    </ConnectionSession>
  )
}
