'use client'

import type {
  GetKnowledgeSpacesByIdSourceConnectionsResponse,
  GetSourceProvidersResponse,
} from '@dify/contracts/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import Link from '@/next/link'
import { consoleClient, consoleQuery } from '@/service/client'
import { newKnowledgeDetailPath } from './routes'
import { WebsiteCrawlPreview } from './website-crawl-preview'

type Provider = GetSourceProvidersResponse['items'][number]
type ProviderField = Provider['configuration'][number]
type Connection = GetKnowledgeSpacesByIdSourceConnectionsResponse['items'][number]
type ConnectionAuthKind = 'api-key' | 'endpoint'
type SourceType = 'onlineDocuments' | 'onlineDrive' | 'websiteCrawl'

const CONNECTION_PAGE_SIZE = 200
const FIRECRAWL_PROVIDER_ID = 'plugin-daemon-website'
const FIRECRAWL_CONNECTION_NAME = 'Firecrawl'
const FIRECRAWL_CONFIGURATION = {
  datasource: 'crawl',
  pluginId: 'langgenius/firecrawl_datasource',
  provider: 'firecrawl',
} as const
const FIRECRAWL_FIXED_FIELD_NAMES = new Set(Object.keys(FIRECRAWL_CONFIGURATION))
const CONNECTION_STATUS_PRIORITY: Record<Connection['status'], number> = {
  active: 0,
  provisioning: 1,
  error: 2,
  expired: 3,
  revoked: 4,
}

function humanizeFieldName(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase())
}

function fieldValue(value: string, type: ProviderField['type']) {
  if (type === 'boolean') return value === 'true'
  if (type === 'integer') return Number.parseInt(value, 10)
  return value.trim()
}

function findFirecrawl(providers: Provider[]) {
  return providers.find((provider) => provider.id === FIRECRAWL_PROVIDER_ID)
}

function findProviderConnection(connections: Connection[], providerId?: string) {
  if (!providerId) return undefined
  return [...connections.filter((connection) => connection.providerId === providerId)].sort(
    (left, right) =>
      CONNECTION_STATUS_PRIORITY[left.status] - CONNECTION_STATUS_PRIORITY[right.status] ||
      right.updatedAt.localeCompare(left.updatedAt),
  )[0]
}

function findConnectionById(connections: Connection[], connectionId: string) {
  return [...connections.filter((connection) => connection.id === connectionId)].sort(
    (left, right) =>
      right.version - left.version ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      CONNECTION_STATUS_PRIORITY[left.status] - CONNECTION_STATUS_PRIORITY[right.status],
  )[0]
}

function getSupportedAuthKinds(provider: Provider) {
  const fields = provider.configuration.filter(
    (field) => !FIRECRAWL_FIXED_FIELD_NAMES.has(field.name),
  )
  const supported: ConnectionAuthKind[] = []
  if (provider.authKinds.includes('api-key') && fields.some((field) => field.secret))
    supported.push('api-key')
  if (
    provider.authKinds.includes('endpoint') &&
    fields.some((field) => !field.secret && field.format === 'uri')
  )
    supported.push('endpoint')
  return supported
}

function SourceTypeSelector({
  value,
  onChange,
}: {
  value: SourceType
  onChange: (value: SourceType) => void
}) {
  const { t } = useTranslation('dataset')
  const options = [
    { icon: 'i-ri-global-line', key: 'websiteCrawl' as const },
    { icon: 'i-ri-file-text-line', key: 'onlineDocuments' as const },
    { icon: 'i-ri-hard-drive-3-line', key: 'onlineDrive' as const },
  ]

  return (
    <fieldset>
      <legend className="mb-1.5 system-xs-medium text-text-secondary">
        {t(($) => $['newKnowledge.sourceTypeLabel'])}
      </legend>
      <div className="grid grid-cols-1 gap-0.5 rounded-lg bg-background-section p-0.5 sm:grid-cols-3">
        {options.map((option) => (
          <label
            key={option.key}
            className={cn(
              'relative flex h-8 items-center justify-center gap-1.5 rounded-md system-xs-medium outline-hidden has-focus-visible:ring-2 has-focus-visible:ring-state-accent-solid',
              value === option.key
                ? 'bg-background-default text-text-primary shadow-xs'
                : 'cursor-pointer text-text-tertiary hover:text-text-secondary',
            )}
          >
            <input
              type="radio"
              name="source-type"
              value={option.key}
              checked={value === option.key}
              onChange={() => onChange(option.key)}
              className="sr-only"
            />
            <span aria-hidden className={`${option.icon} size-4`} />
            {t(($) => $[`newKnowledge.${option.key}`])}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function ProviderSelector() {
  const { t } = useTranslation('datasetCreation')

  return (
    <fieldset>
      <legend className="mb-1.5 system-xs-medium text-text-secondary">
        {t(($) => $['stepOne.website.chooseProvider'])}
      </legend>
      <label className="relative flex h-9 w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg px-3 system-xs-medium text-text-primary has-focus-visible:ring-2 has-focus-visible:ring-state-accent-solid sm:w-40">
        <input
          type="radio"
          name="source-provider"
          value={FIRECRAWL_PROVIDER_ID}
          checked
          readOnly
          className="sr-only"
        />
        <span aria-hidden className="i-ri-fire-fill size-4 text-orange-500" />
        {FIRECRAWL_CONNECTION_NAME}
      </label>
    </fieldset>
  )
}

function ProviderFieldControl({
  field,
  setValues,
  values,
}: {
  field: ProviderField
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>
  values: Record<string, string>
}) {
  const { t } = useTranslation('dataset')
  const generatedId = useId()
  const inputId = `${generatedId}-input`
  const descriptionId = field.description ? `${generatedId}-description` : undefined
  const label = humanizeFieldName(field.name)
  const sharedProps = {
    'aria-describedby': descriptionId,
    id: inputId,
    required: field.required,
    value: values[field.name] ?? '',
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((current) => ({ ...current, [field.name]: event.target.value })),
  }

  return (
    <div>
      <label htmlFor={inputId} className="system-xs-medium text-text-secondary">
        {label}
        {field.required && <span className="ml-0.5 text-text-destructive">*</span>}
      </label>
      {field.type === 'boolean' ? (
        <select
          {...sharedProps}
          className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden focus:ring-2 focus:ring-state-accent-solid"
        >
          <option value="">—</option>
          <option value="true">{t(($) => $['newKnowledge.booleanTrue'])}</option>
          <option value="false">{t(($) => $['newKnowledge.booleanFalse'])}</option>
        </select>
      ) : (
        <input
          {...sharedProps}
          type={
            field.secret
              ? 'password'
              : field.type === 'integer'
                ? 'number'
                : field.format === 'uri'
                  ? 'url'
                  : 'text'
          }
          inputMode={field.format === 'uri' ? 'url' : undefined}
          autoComplete={field.secret ? 'new-password' : 'off'}
          className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden focus:ring-2 focus:ring-state-accent-solid"
        />
      )}
      {field.description && (
        <p id={descriptionId} className="mt-1 system-xs-regular text-text-tertiary">
          {field.description}
        </p>
      )}
    </div>
  )
}

function ConnectionForm({
  knowledgeSpaceId,
  onConnected,
  onReconcile,
  provider,
}: {
  knowledgeSpaceId: string
  onConnected: (connection: Connection) => void
  onReconcile: () => Promise<Connection | undefined>
  provider: Provider
}) {
  const { t } = useTranslation('dataset')
  const supportedAuthKinds = getSupportedAuthKinds(provider)
  const [authKind, setAuthKind] = useState<ConnectionAuthKind>(supportedAuthKinds[0] ?? 'api-key')
  const [configuration, setConfiguration] = useState<Record<string, string>>({})
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [error, setError] = useState(false)
  const [pending, setPending] = useState(false)
  const configurableFields = provider.configuration.filter(
    (field) => !FIRECRAWL_FIXED_FIELD_NAMES.has(field.name),
  )
  const visibleFields = configurableFields.filter(
    (field) => authKind === 'api-key' || (!field.secret && field.format === 'uri'),
  )

  const changeAuthKind = (nextAuthKind: ConnectionAuthKind) => {
    if (nextAuthKind !== authKind) setCredentials({})
    setAuthKind(nextAuthKind)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return

    const missingRequiredField = visibleFields.some((field) => {
      const values = field.secret ? credentials : configuration
      return field.required && !values[field.name]?.trim()
    })
    if (missingRequiredField) return

    setError(false)
    setPending(true)
    try {
      const fixedConfiguration = Object.fromEntries(
        provider.configuration
          .filter((field) => FIRECRAWL_FIXED_FIELD_NAMES.has(field.name))
          .map((field) => [
            field.name,
            FIRECRAWL_CONFIGURATION[field.name as keyof typeof FIRECRAWL_CONFIGURATION],
          ]),
      )
      const safeConfiguration = {
        ...fixedConfiguration,
        ...Object.fromEntries(
          visibleFields
            .filter((field) => !field.secret && configuration[field.name]?.trim())
            .map((field) => [field.name, fieldValue(configuration[field.name] ?? '', field.type)]),
        ),
      }
      const secretCredentials = Object.fromEntries(
        visibleFields
          .filter((field) => field.secret && credentials[field.name]?.trim())
          .map((field) => [field.name, fieldValue(credentials[field.name] ?? '', field.type)]),
      )
      const createdConnection =
        await consoleClient.knowledgeFs.postKnowledgeSpacesByIdSourceConnections({
          body: {
            authKind,
            configuration: safeConfiguration,
            credentials: secretCredentials,
            name: FIRECRAWL_CONNECTION_NAME,
            providerId: provider.id,
          },
          params: { id: knowledgeSpaceId },
        })
      setCredentials({})
      onConnected(createdConnection)
    } catch {
      setCredentials({})
      let reconciledConnection: Connection | undefined
      try {
        reconciledConnection = await onReconcile()
      } catch {
        reconciledConnection = undefined
      }
      if (!reconciledConnection) setError(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="rounded-xl bg-background-section p-4" onSubmit={handleSubmit}>
      {supportedAuthKinds.length > 1 && (
        <fieldset className="mb-4">
          <legend className="mb-1.5 system-xs-medium text-text-secondary">
            {t(($) => $['newKnowledge.authenticationMethod'])}
          </legend>
          <div className="flex gap-2">
            {supportedAuthKinds.map((kind) => (
              <label
                key={kind}
                className="flex items-center gap-1.5 system-xs-regular text-text-secondary"
              >
                <input
                  type="radio"
                  name="auth-kind"
                  value={kind}
                  checked={authKind === kind}
                  onChange={() => changeAuthKind(kind)}
                />
                {t(($) => $[`newKnowledge.authKind.${kind}`])}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="space-y-3">
        {visibleFields.map((field) => (
          <ProviderFieldControl
            key={field.name}
            field={field}
            values={field.secret ? credentials : configuration}
            setValues={field.secret ? setCredentials : setConfiguration}
          />
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 system-xs-regular text-text-destructive">
          {t(($) => $['newKnowledge.connectionFailed'])}
        </p>
      )}
      <Button type="submit" variant="primary" className="mt-4" disabled={pending}>
        {pending
          ? t(($) => $['newKnowledge.connectingProvider'])
          : t(($) => $['newKnowledge.connectProvider'])}
      </Button>
    </form>
  )
}

function UnconfiguredProvider({
  knowledgeSpaceId,
  onConnected,
  onReconcile,
  provider,
}: {
  knowledgeSpaceId: string
  onConnected: (connection: Connection) => void
  onReconcile: () => Promise<Connection | undefined>
  provider: Provider
}) {
  const { t } = useTranslation('dataset')
  const [configuring, setConfiguring] = useState(false)

  if (configuring)
    return (
      <ConnectionForm
        knowledgeSpaceId={knowledgeSpaceId}
        onConnected={onConnected}
        onReconcile={onReconcile}
        provider={provider}
      />
    )

  return (
    <div className="rounded-xl bg-background-section p-4">
      <span className="flex size-9 items-center justify-center rounded-lg border border-divider-subtle bg-background-default">
        <span aria-hidden className="i-ri-fire-line size-[18px] text-text-tertiary" />
      </span>
      <h3 className="mt-3 system-sm-semibold text-text-primary">
        {t(($) => $['newKnowledge.providerNotConfigured'], {
          provider: FIRECRAWL_CONNECTION_NAME,
        })}
      </h3>
      <p className="mt-1 system-xs-regular text-text-tertiary">
        {t(($) => $['newKnowledge.providerNotConfiguredDescription'], {
          provider: FIRECRAWL_CONNECTION_NAME,
        })}
      </p>
      <Button variant="primary" className="mt-4" onClick={() => setConfiguring(true)}>
        {t(($) => $['newKnowledge.configureProvider'])}
      </Button>
    </div>
  )
}

function ConnectionProblem({
  connection,
  knowledgeSpaceId,
  onConnected,
  onReconcile,
}: {
  connection: Connection
  knowledgeSpaceId: string
  onConnected: (connection: Connection) => void
  onReconcile: () => Promise<Connection | undefined>
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)

  const refresh = async () => {
    if (pending) return
    setPending(true)
    setError(false)
    try {
      const refreshed =
        await consoleClient.knowledgeFs.postKnowledgeSpacesByIdSourceConnectionsByConnectionIdRefresh(
          {
            body: { expectedVersion: connection.version },
            params: { connectionId: connection.id, id: knowledgeSpaceId },
          },
        )
      onConnected(refreshed)
    } catch {
      let reconciledConnection: Connection | undefined
      try {
        reconciledConnection = await onReconcile()
      } catch {
        reconciledConnection = undefined
      }
      if (!reconciledConnection) setError(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="rounded-xl border border-components-option-card-option-border bg-background-section p-4">
      <h3 className="system-sm-semibold text-text-primary">
        {t(($) => $['newKnowledge.connectionNeedsAttention'])}
      </h3>
      <p className="mt-1 system-xs-regular text-text-tertiary">
        {t(($) => $['newKnowledge.connectionNeedsAttentionDescription'])}
      </p>
      {error && (
        <p role="alert" className="mt-2 system-xs-regular text-text-destructive">
          {t(($) => $['newKnowledge.connectionRefreshFailed'])}
        </p>
      )}
      <Button className="mt-4" onClick={() => void refresh()} disabled={pending}>
        {pending
          ? t(($) => $['newKnowledge.refreshingConnection'])
          : tCommon(($) => $['operation.retry'])}
      </Button>
    </div>
  )
}

function ProvisioningConnection({
  onReconcile,
}: {
  onReconcile: () => Promise<Connection | undefined>
}) {
  const { t } = useTranslation('dataset')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)

  const refresh = async () => {
    if (pending) return
    setPending(true)
    setError(false)
    try {
      const reconciledConnection = await onReconcile()
      if (!reconciledConnection) setError(true)
    } catch {
      setError(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="rounded-xl bg-background-section p-4">
      <p className="system-sm-semibold text-text-primary">
        {t(($) => $['newKnowledge.connectionProvisioning'])}
      </p>
      {error && (
        <p role="alert" className="mt-2 system-xs-regular text-text-destructive">
          {t(($) => $['newKnowledge.connectionRefreshFailed'])}
        </p>
      )}
      <Button className="mt-3" loading={pending} onClick={() => void refresh()} disabled={pending}>
        {t(($) => $['newKnowledge.refreshConnectionStatus'])}
      </Button>
    </div>
  )
}

export function AddSourcePage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const queryClient = useQueryClient()
  const [sourceType, setSourceType] = useState<SourceType>('websiteCrawl')
  const providersQuery = useQuery(
    consoleQuery.knowledgeFs.getSourceProviders.queryOptions({
      input: {},
      context: { silent: true },
      retry: false,
    }),
  )
  const connectionsQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.getKnowledgeSpacesByIdSourceConnections.infiniteOptions({
      context: { silent: true },
      input: (pageParam) => ({
        params: { id: knowledgeSpaceId },
        query: {
          limit: CONNECTION_PAGE_SIZE,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: null as string | null,
      retry: false,
    }),
  )
  const provider = findFirecrawl(providersQuery.data?.items ?? [])
  const remoteConnections = connectionsQuery.data?.pages.flatMap((page) => page.items) ?? []
  const remoteConnection = findProviderConnection(remoteConnections, provider?.id)
  const [connectionOverride, setConnectionOverride] = useState<Connection>()
  const matchingRemoteConnection = connectionOverride
    ? remoteConnections.find((candidate) => candidate.id === connectionOverride.id)
    : undefined
  const connection = useMemo(() => {
    const localConnection = connectionOverride
    if (!localConnection || localConnection.providerId !== provider?.id) return remoteConnection
    if (!matchingRemoteConnection) return localConnection
    if (matchingRemoteConnection.id === localConnection.id) {
      if (matchingRemoteConnection.version > localConnection.version)
        return matchingRemoteConnection
      if (matchingRemoteConnection.version < localConnection.version) return localConnection
      if (matchingRemoteConnection.updatedAt > localConnection.updatedAt)
        return matchingRemoteConnection
      if (matchingRemoteConnection.updatedAt < localConnection.updatedAt) return localConnection
      if (
        CONNECTION_STATUS_PRIORITY[matchingRemoteConnection.status] <
        CONNECTION_STATUS_PRIORITY[localConnection.status]
      )
        return matchingRemoteConnection
    }
    return localConnection
  }, [connectionOverride, matchingRemoteConnection, provider?.id, remoteConnection])
  const supportsDirectConnection = provider ? getSupportedAuthKinds(provider).length > 0 : false
  const {
    fetchNextPage: fetchNextConnectionPage,
    hasNextPage: hasNextConnectionPage,
    isFetchingNextPage: isFetchingNextConnectionPage,
    refetch: refetchConnections,
  } = connectionsQuery

  useEffect(() => {
    if (
      hasNextConnectionPage &&
      !isFetchingNextConnectionPage &&
      !connectionsQuery.isFetchNextPageError
    )
      void fetchNextConnectionPage()
  }, [
    connectionsQuery.isFetchNextPageError,
    fetchNextConnectionPage,
    hasNextConnectionPage,
    isFetchingNextConnectionPage,
  ])

  const rememberConnection = useCallback(
    (updatedConnection: Connection) => {
      setConnectionOverride(updatedConnection)
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.getKnowledgeSpacesByIdSourceConnections.key(),
      })
    },
    [queryClient],
  )

  const reconcileConnection = useCallback(async () => {
    if (connection) setConnectionOverride(connection)
    const refreshed = await refetchConnections()
    if (refreshed.error) throw refreshed.error
    const refreshedConnections = refreshed.data?.pages.flatMap((page) => page.items) ?? []
    const refreshedCurrentConnection = connection
      ? findConnectionById(refreshedConnections, connection.id)
      : undefined
    const updatedConnection = connection
      ? refreshedCurrentConnection
        ? findConnectionById([connection, refreshedCurrentConnection], connection.id)
        : undefined
      : findProviderConnection(refreshedConnections, provider?.id)
    if (updatedConnection) setConnectionOverride(updatedConnection)
    return updatedConnection
  }, [connection, provider?.id, refetchConnections])

  const loadingConnections =
    connectionsQuery.isPending ||
    (!connectionsQuery.isFetchNextPageError &&
      (connectionsQuery.hasNextPage || connectionsQuery.isFetchingNextPage))
  if (providersQuery.isPending || loadingConnections)
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Loading />
      </div>
    )

  const queryError =
    providersQuery.error || connectionsQuery.error || connectionsQuery.isFetchNextPageError

  return (
    <main className="min-h-full px-4 py-6 sm:px-8 sm:py-7">
      <header>
        <h2 className="title-xl-semi-bold text-text-primary">
          {t(($) => $['newKnowledge.addSource'])}
        </h2>
        <p className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.addSourceDescription'])}
        </p>
      </header>
      <div className="mt-5 w-full max-w-2xl space-y-4">
        <SourceTypeSelector value={sourceType} onChange={setSourceType} />
        {sourceType === 'websiteCrawl' ? (
          <>
            {provider && <ProviderSelector />}
            {queryError ? (
              <div className="rounded-xl bg-background-section p-4">
                <p className="system-sm-semibold text-text-primary">
                  {t(($) => $['newKnowledge.providerLoadFailed'])}
                </p>
                <Button
                  className="mt-3"
                  onClick={() =>
                    void Promise.all([providersQuery.refetch(), connectionsQuery.refetch()])
                  }
                >
                  {t(($) => $['newKnowledge.retryProviderLoad'])}
                </Button>
              </div>
            ) : !provider ? (
              <div className="rounded-xl bg-background-section p-4 system-sm-regular text-text-tertiary">
                {t(($) => $['newKnowledge.firecrawlUnavailable'])}
              </div>
            ) : !provider.available || !supportsDirectConnection ? (
              <div className="rounded-xl bg-background-section p-4">
                <p className="system-sm-semibold text-text-primary">{FIRECRAWL_CONNECTION_NAME}</p>
                <p className="mt-1 system-xs-regular text-text-tertiary">
                  {provider.unavailableReason ?? t(($) => $['newKnowledge.providerUnavailable'])}
                </p>
              </div>
            ) : connection?.status === 'active' ? (
              <WebsiteCrawlPreview connection={connection} knowledgeSpaceId={knowledgeSpaceId} />
            ) : connection?.status === 'provisioning' ? (
              <ProvisioningConnection onReconcile={reconcileConnection} />
            ) : connection ? (
              <ConnectionProblem
                connection={connection}
                knowledgeSpaceId={knowledgeSpaceId}
                onConnected={rememberConnection}
                onReconcile={reconcileConnection}
              />
            ) : (
              <UnconfiguredProvider
                knowledgeSpaceId={knowledgeSpaceId}
                onConnected={rememberConnection}
                onReconcile={reconcileConnection}
                provider={provider}
              />
            )}
          </>
        ) : (
          <div role="status" className="rounded-xl bg-background-section p-4">
            <p className="system-sm-semibold text-text-primary">
              {t(($) => $[`newKnowledge.${sourceType}`])}
            </p>
            <p className="mt-1 system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.providerUnavailable'])}
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-divider-subtle pt-5">
          <Link
            href={newKnowledgeDetailPath(knowledgeSpaceId)}
            className="inline-flex h-8 items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3.5 system-sm-medium text-components-button-secondary-text shadow-xs outline-hidden hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            {t(($) => $['newKnowledge.cancelAddSource'])}
          </Link>
          {sourceType === 'websiteCrawl' ? (
            <>
              <span id="add-source-selection-requirement" className="sr-only">
                {t(($) => $['newKnowledge.addSourceRequiresSelection'])}
              </span>
              <Button
                variant="primary"
                disabled
                aria-describedby="add-source-selection-requirement"
              >
                {t(($) => $['newKnowledge.addSource'])}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={() => toast.info(t(($) => $['newKnowledge.providerUnavailable']))}
            >
              {t(($) => $['newKnowledge.addSource'])}
            </Button>
          )}
        </div>
      </div>
    </main>
  )
}
