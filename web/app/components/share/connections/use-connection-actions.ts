'use client'

import type {
  ConnectionCredentialSchemaResponse,
  EndUserConnectionResponse,
  WebAppConnectionRequirement,
} from '@dify/contracts/api/web/types.gen'
import type { UseQueryOptions } from '@tanstack/react-query'
import type { ApiKeyValues } from './api-key-form'
import type { ConnectionMethod, RequiredConnectionService } from './required-services'
import type { WebAppAddress } from '@/service/webapp-address'
import { skipToken, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { isAbortError } from '@/service/client-error'
import { webAppClient, webAppQuery } from '@/service/webapp'
import { getWebAppScopeKey, resolveWebAppAddress } from '@/service/webapp-address'
import { captureWebAppAuthSession } from '@/service/webapp-auth'
import { authorizeConnection } from './oauth-popup'

type Props = {
  address: WebAppAddress
  authSession: number
  connectionRevision: string | null | undefined
  requirements: readonly WebAppConnectionRequirement[]
  services: readonly RequiredConnectionService[]
  disabled: boolean
  oauthCallbackOrigin?: string
  onSaved: (nodeId: string, connection: EndUserConnectionResponse) => void
  onRemoved: (connectionId: string) => void
  refreshConnections: () => Promise<void>
}

export function connectionDetailQueryKey(
  address: WebAppAddress,
  authSession: number,
  connectionId: string,
) {
  return [
    'webapp',
    ...webAppQuery.connections.byConnectionId.get.queryKey({
      input: { params: { connection_id: connectionId } },
    }),
    address,
    authSession,
  ]
}

export default function useConnectionActions({
  address,
  authSession,
  connectionRevision,
  requirements,
  services,
  disabled,
  oauthCallbackOrigin,
  onSaved,
  onRemoved,
  refreshConnections,
}: Props) {
  const { t } = useTranslation(['common', 'share'])
  const queryClient = useQueryClient()
  const context = { address, authSession, silent: true }
  const create = useMutation(webAppQuery.connections.post.mutationOptions({ context }))
  const update = useMutation(
    webAppQuery.connections.byConnectionId.patch.mutationOptions({ context }),
  )
  const remove = useMutation(
    webAppQuery.connections.byConnectionId.delete.mutationOptions({ context }),
  )
  const startOAuth = useMutation(
    webAppQuery.connections.oauth.authorizationUrl.post.mutationOptions({ context }),
  )
  const reauthorize = useMutation(
    webAppQuery.connections.byConnectionId.reauthorize.post.mutationOptions({ context }),
  )
  const [isMutating, setIsMutating] = useState(false)
  const operationRef = useRef<AbortController | null>(null)

  useEffect(() => () => operationRef.current?.abort(), [])

  const execute = async (
    run: (signal: AbortSignal, assertCurrent: () => void) => Promise<void>,
  ) => {
    if (disabled || operationRef.current)
      throw new DOMException('Connection actions are unavailable.', 'AbortError')
    const controller = new AbortController()
    const isSameAccount = captureWebAppAuthSession()
    const assertCurrent = () => {
      const current = resolveWebAppAddress()
      if (
        controller.signal.aborted ||
        !isSameAccount() ||
        !current ||
        getWebAppScopeKey(current) !== getWebAppScopeKey(address)
      )
        throw new DOMException('The connection session changed.', 'AbortError')
    }
    operationRef.current = controller
    setIsMutating(true)
    try {
      assertCurrent()
      await run(controller.signal, assertCurrent)
    } catch (error) {
      assertCurrent()
      throw error
    } finally {
      if (!controller.signal.aborted) {
        operationRef.current = null
        setIsMutating(false)
      }
    }
  }

  const findSource = (nodeId: string) => {
    const source = requirements.find(
      (item) => item.node_id === nodeId || item.node_ids.includes(nodeId),
    )
    if (!source) throw new Error('The authorization source is no longer available.')
    return source
  }
  const requireApiKeySource = (nodeId: string) => {
    const source = findSource(nodeId)
    if (!source.allowed_credential_types.includes('api-key'))
      throw new Error('API key configuration is unavailable for this source.')
    return source
  }
  const getApiKeyValues = (values: ApiKeyValues | undefined) => {
    if (!values) throw new Error('Connection configuration is incomplete.')
    return { name: values.name.trim(), credentials: values.credentials }
  }
  const getApiKeySchemaOptions = (
    nodeId: string,
  ): UseQueryOptions<ConnectionCredentialSchemaResponse> => {
    const source = requirements.find(
      (item) => item.node_id === nodeId || item.node_ids.includes(nodeId),
    )
    return webAppQuery.connections.credentialSchema.get.queryOptions({
      input:
        !disabled && connectionRevision && source?.allowed_credential_types.includes('api-key')
          ? { query: { connection_revision: connectionRevision, node_id: source.node_id } }
          : skipToken,
      queryKey: [
        ...webAppQuery.connections.credentialSchema.get.key(),
        address,
        authSession,
        connectionRevision,
        nodeId,
      ],
      context,
      staleTime: 0,
      gcTime: 0,
      retry: false,
      refetchOnWindowFocus: false,
    })
  }

  const requireConnection = (nodeId: string, connectionId: string, method?: ConnectionMethod) => {
    const source = findSource(nodeId)
    const connection = services
      .find((item) => item.id === source.node_id)
      ?.availableConnections.find((item) => item.id === connectionId)
    if (!connection || (method && connection.method !== method))
      throw new Error('The connection is no longer available for this source.')
    return source
  }
  const saveResult = async (
    source: WebAppConnectionRequirement,
    connection: EndUserConnectionResponse,
    assertCurrent: () => void,
  ) => {
    assertCurrent()
    if (
      connection.provider !== source.provider ||
      !source.allowed_credential_types.includes(connection.credential_type)
    )
      throw new Error('The returned connection does not match this authorization source.')
    onSaved(source.node_id, connection)
    await refreshConnections()
  }
  const getOAuthResult = async (connectionId: string) =>
    queryClient.query(
      webAppQuery.connections.byConnectionId.get.queryOptions({
        input: { params: { connection_id: connectionId } },
        queryKey: connectionDetailQueryKey(address, authSession, connectionId),
        context,
        staleTime: 0,
        retry: false,
      }),
    )

  const reportOAuthFailure = (error: unknown) => {
    if (isAbortError(error)) return
    toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
  }

  const onConnect = async (nodeId: string, method: ConnectionMethod, values?: ApiKeyValues) => {
    if (method === 'api-key') {
      await execute(async (_signal, assertCurrent) => {
        const source = requireApiKeySource(nodeId)
        if (!connectionRevision) throw new Error('Connection configuration is incomplete.')
        const apiKeyValues = getApiKeyValues(values)
        const connection = await create.mutateAsync({
          body: {
            connection_revision: connectionRevision,
            node_id: source.node_id,
            ...apiKeyValues,
            name: apiKeyValues.name || t(($) => $['connections.setup.apiKey'], { ns: 'share' }),
          },
        })
        await saveResult(source, connection, assertCurrent)
      })
      return
    }
    await execute(async (signal, assertCurrent) => {
      const source = findSource(nodeId)
      if (!connectionRevision || !source.allowed_credential_types.includes('oauth2'))
        throw new Error('OAuth is unavailable for this source.')
      const connectionId = await authorizeConnection(
        () =>
          startOAuth.mutateAsync({
            body: {
              connection_revision: connectionRevision,
              node_id: source.node_id,
              name: (source.title.trim() || source.provider).slice(0, 100),
            },
          }),
        { signal, callbackOrigin: oauthCallbackOrigin },
      )
      if (!connectionId) return
      assertCurrent()
      const connection = await getOAuthResult(connectionId)
      if (connection.credential_type !== 'oauth2')
        throw new Error('The OAuth callback did not identify an OAuth connection.')
      await saveResult(source, connection, assertCurrent)
    }).catch(reportOAuthFailure)
  }

  const onReplace = async (nodeId: string, connectionId: string, values: ApiKeyValues) =>
    execute(async (_signal, assertCurrent) => {
      const source = requireApiKeySource(nodeId)
      requireConnection(nodeId, connectionId, 'api-key')
      const apiKeyValues = getApiKeyValues(values)
      const revision = await webAppClient.connections.byConnectionId.revision.get(
        { params: { connection_id: connectionId } },
        { context },
      )
      assertCurrent()
      const connection = await update.mutateAsync({
        params: { connection_id: connectionId },
        body: {
          connection_revision: revision.connection_revision,
          credentials: apiKeyValues.credentials,
          ...(apiKeyValues.name ? { name: apiKeyValues.name } : {}),
        },
      })
      if (connection.id !== connectionId)
        throw new Error('The update returned a different connection.')
      await saveResult(source, connection, assertCurrent)
    })

  const onRemove = async (nodeId: string, connectionId: string) =>
    execute(async (_signal, assertCurrent) => {
      requireConnection(nodeId, connectionId)
      await remove.mutateAsync({ params: { connection_id: connectionId } })
      assertCurrent()
      onRemoved(connectionId)
      await refreshConnections()
    })

  const onReconnect = async (nodeId: string, connectionId: string) => {
    await execute(async (signal, assertCurrent) => {
      const source = requireConnection(nodeId, connectionId, 'oauth')
      const returnedId = await authorizeConnection(
        async () => {
          const revision = await webAppClient.connections.byConnectionId.revision.get(
            { params: { connection_id: connectionId } },
            { context },
          )
          assertCurrent()
          return reauthorize.mutateAsync({
            params: { connection_id: connectionId },
            body: { connection_revision: revision.connection_revision },
          })
        },
        { signal, callbackOrigin: oauthCallbackOrigin },
      )
      if (!returnedId) return
      assertCurrent()
      if (returnedId !== connectionId)
        throw new Error('The OAuth callback identified a different connection.')
      await saveResult(source, await getOAuthResult(returnedId), assertCurrent)
    }).catch(reportOAuthFailure)
  }

  return { onConnect, onReplace, onRemove, onReconnect, isMutating, getApiKeySchemaOptions }
}
