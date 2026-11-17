'use client'

import type {
  EndUserConnectionPreflightPayload,
  EndUserConnectionPreflightResponse,
  EndUserConnectionResponse,
  WebAppConnectionRequirement,
} from '@dify/contracts/api/web/types.gen'
import type { WebAppAddress } from '@/service/webapp-address'
import { ORPCError } from '@orpc/client'
import { skipToken, useQuery } from '@tanstack/react-query'
import { isAbortError } from '@/service/client-error'
import { getHttpErrorStatus, isTransientHttpError } from '@/service/http-error'
import { webAppQuery } from '@/service/webapp'

type Props = {
  address: WebAppAddress
  authSession: number
  conversationId?: string
  connectionRevision: string | null | undefined
  requirements: readonly WebAppConnectionRequirement[]
  selections: Readonly<Record<string, string | null>>
  selectedConnections: readonly (EndUserConnectionResponse | null)[]
  validationRevision: number
  requiresConnections: boolean
  canRunWithoutConnections: boolean
  enabled: boolean
}

export type ConnectionPreflightState = {
  status: 'inactive' | 'pending' | 'checking' | 'ready' | 'blocked' | 'error'
  response: EndUserConnectionPreflightResponse | null
  error: Error | null
  canRetry: boolean
  retry: () => void
}

export default function useConnectionPreflight({
  address,
  authSession,
  conversationId,
  connectionRevision,
  requirements,
  selections,
  selectedConnections,
  validationRevision,
  requiresConnections,
  canRunWithoutConnections,
  enabled,
}: Props): {
  canRun: boolean
  runConfiguration: EndUserConnectionPreflightPayload | null
  preflight: ConnectionPreflightState
} {
  const body: EndUserConnectionPreflightPayload | null = connectionRevision
    ? {
        connection_revision: connectionRevision,
        connections: Object.fromEntries(
          requirements.map(({ node_id }) => [node_id, selections[node_id] ?? null]),
        ),
        ...(conversationId !== undefined ? { conversation_id: conversationId } : {}),
      }
    : null
  const canCheck = requiresConnections && enabled && requirements.length > 0 && body !== null
  const input = body ? { body } : skipToken
  const query = useQuery(
    webAppQuery.connections.preflight.post.queryOptions({
      input,
      queryKey: [
        'webapp',
        ...webAppQuery.connections.preflight.post.queryKey({ input }),
        address,
        authSession,
        requirements,
        selectedConnections.map((connection) =>
          connection ? [connection.id, connection.credential_status, connection.updated_at] : null,
        ),
        validationRevision,
      ],
      context: { address, authSession, silent: true },
      // A suspended snapshot must not silently retry a failed check when it resumes.
      enabled: (current) => canCheck && current.state.error === null,
      retry: false,
      retryOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
      gcTime: 0,
    }),
  )
  const error = canCheck && query.error && !isAbortError(query.error) ? query.error : null
  const response = canCheck && !query.isFetching && !query.error ? (query.data ?? null) : null
  const results = new Map(
    response?.connections.map((connection) => [connection.node_id, connection]),
  )
  const allConnected =
    response?.ready === true &&
    response.connections.length === requirements.length &&
    results.size === requirements.length &&
    requirements.every(({ node_id }) => {
      const result = results.get(node_id)
      const selectedId = body?.connections[node_id]
      return selectedId && result?.connection_id === selectedId && result.status === 'connected'
    })
  const runConfiguration =
    body && response && allConnected
      ? { ...body, connection_revision: response.connection_revision }
      : null
  const canRetry = Boolean(
    canCheck &&
    !query.isFetching &&
    (error
      ? isTransientHttpError(error) ||
        getHttpErrorStatus(error) === undefined ||
        (error instanceof ORPCError && error.code === 'connection_conflict')
      : response?.connections.some((connection) => connection.check?.retryable)),
  )
  let status: ConnectionPreflightState['status']
  if (!requiresConnections) status = 'inactive'
  else if (!body || requirements.length === 0) status = 'blocked'
  else if (!canCheck) status = 'pending'
  else if (query.isFetching) status = 'checking'
  else if (error) status = 'error'
  else if (runConfiguration) status = 'ready'
  else if (response) status = 'blocked'
  else status = 'pending'

  return {
    canRun: requiresConnections ? runConfiguration !== null : canRunWithoutConnections,
    runConfiguration,
    preflight: {
      status,
      response,
      error,
      canRetry,
      retry: () => {
        if (canRetry) void query.refetch()
      },
    },
  }
}
