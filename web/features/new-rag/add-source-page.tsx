'use client'

import type {
  GetKnowledgeSpacesByIdSourceConnectionsResponse,
  GetSourceProvidersResponse,
} from '@dify/contracts/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import Link from '@/next/link'
import { consoleClient, consoleQuery } from '@/service/client'
import { newKnowledgeDetailPath } from './routes'

type Provider = GetSourceProvidersResponse['items'][number]
type Connection = GetKnowledgeSpacesByIdSourceConnectionsResponse['items'][number]
type ConnectionAuthKind = 'api-key' | 'endpoint'

function humanizeFieldName(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase())
}

function fieldValue(value: string, type: Provider['configuration'][number]['type']) {
  if (type === 'boolean') return value === 'true'
  if (type === 'integer') return Number.parseInt(value, 10)
  return value.trim()
}

function findFirecrawl(providers: Provider[]) {
  return providers.find(
    (provider) =>
      provider.capabilities.includes('website-crawl') &&
      `${provider.id} ${provider.displayName}`.toLocaleLowerCase().includes('firecrawl'),
  )
}

function findProviderConnection(connections: Connection[], providerId?: string) {
  if (!providerId) return undefined
  const statusPriority: Record<Connection['status'], number> = {
    active: 0,
    provisioning: 1,
    error: 2,
    expired: 3,
    revoked: 4,
  }
  return [...connections.filter((connection) => connection.providerId === providerId)].sort(
    (left, right) =>
      statusPriority[left.status] - statusPriority[right.status] ||
      right.updatedAt.localeCompare(left.updatedAt),
  )[0]
}

function SourceTypeSelector() {
  const { t } = useTranslation('dataset')
  const options = [
    { disabled: false, icon: 'i-ri-global-line', key: 'websiteCrawl' as const },
    { disabled: true, icon: 'i-ri-file-text-line', key: 'onlineDocuments' as const },
    { disabled: true, icon: 'i-ri-hard-drive-3-line', key: 'onlineDrive' as const },
  ]

  return (
    <div>
      <p className="mb-1.5 system-xs-medium text-text-secondary">
        {t(($) => $['newKnowledge.sourceTypeLabel'])}
      </p>
      <div className="grid grid-cols-1 gap-0.5 rounded-lg bg-background-section p-0.5 sm:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            disabled={option.disabled}
            className={cn(
              'flex h-8 items-center justify-center gap-1.5 rounded-md system-xs-medium outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              option.disabled
                ? 'cursor-not-allowed text-text-disabled'
                : 'bg-background-default text-text-primary shadow-xs',
            )}
          >
            <span aria-hidden className={`${option.icon} size-4`} />
            {t(($) => $[`newKnowledge.${option.key}`])}
          </button>
        ))}
      </div>
    </div>
  )
}

function ProviderConfigured({ provider }: { provider: Provider }) {
  const { t } = useTranslation('dataset')

  return (
    <div className="rounded-xl border border-components-option-card-option-border bg-background-default p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-components-badge-status-light-success-bg text-text-success">
          <span aria-hidden className="i-ri-check-line size-4" />
        </span>
        <div>
          <p className="system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.providerConnected'])}
          </p>
          <p className="system-xs-regular text-text-tertiary">{provider.displayName}</p>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-dashed border-divider-regular bg-background-section px-4 py-5 text-center">
        <p className="system-xs-medium text-text-secondary">
          {t(($) => $['newKnowledge.crawlSetupUnavailableTitle'])}
        </p>
        <p className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.crawlSetupUnavailableDescription'])}
        </p>
        <Button className="mt-3" disabled>
          {t(($) => $['newKnowledge.crawlAndPreview'])}
        </Button>
      </div>
    </div>
  )
}

function ConnectionForm({
  knowledgeSpaceId,
  onConnected,
  provider,
}: {
  knowledgeSpaceId: string
  onConnected: (connection: Connection) => void
  provider: Provider
}) {
  const { t } = useTranslation('dataset')
  const [authKind, setAuthKind] = useState<ConnectionAuthKind>(() =>
    provider.authKinds.includes('api-key') ? 'api-key' : 'endpoint',
  )
  const [configuration, setConfiguration] = useState<Record<string, string>>({})
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [error, setError] = useState(false)
  const [pending, setPending] = useState(false)
  const supportedAuthKinds = provider.authKinds.filter(
    (kind): kind is ConnectionAuthKind => kind === 'api-key' || kind === 'endpoint',
  )
  const visibleFields = provider.configuration.filter(
    (field) => authKind === 'api-key' || !field.secret,
  )

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
      const safeConfiguration = Object.fromEntries(
        visibleFields
          .filter((field) => !field.secret && configuration[field.name]?.trim())
          .map((field) => [field.name, fieldValue(configuration[field.name] ?? '', field.type)]),
      )
      const secretCredentials = Object.fromEntries(
        visibleFields
          .filter((field) => field.secret && credentials[field.name]?.trim())
          .map((field) => [field.name, fieldValue(credentials[field.name] ?? '', field.type)]),
      )
      const connection = await consoleClient.knowledgeFs.postKnowledgeSpacesByIdSourceConnections({
        body: {
          authKind,
          configuration: safeConfiguration,
          credentials: secretCredentials,
          name: provider.displayName,
          providerId: provider.id,
        },
        params: { id: knowledgeSpaceId },
      })
      setCredentials({})
      onConnected(connection)
    } catch {
      setCredentials({})
      setError(true)
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
                  onChange={() => setAuthKind(kind)}
                />
                {t(($) => $[`newKnowledge.authKind.${kind}`])}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="space-y-3">
        {visibleFields.map((field) => {
          const values = field.secret ? credentials : configuration
          const setValues = field.secret ? setCredentials : setConfiguration
          const label = humanizeFieldName(field.name)
          return (
            <label key={field.name} className="block">
              <span className="system-xs-medium text-text-secondary">
                {label}
                {field.required && <span className="ml-0.5 text-text-destructive">*</span>}
              </span>
              {field.type === 'boolean' ? (
                <select
                  aria-label={label}
                  required={field.required}
                  value={values[field.name] ?? ''}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                  className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden focus:ring-2 focus:ring-state-accent-solid"
                >
                  <option value="">—</option>
                  <option value="true">{t(($) => $['newKnowledge.booleanTrue'])}</option>
                  <option value="false">{t(($) => $['newKnowledge.booleanFalse'])}</option>
                </select>
              ) : (
                <input
                  aria-label={label}
                  type={
                    field.secret
                      ? 'password'
                      : field.type === 'integer'
                        ? 'number'
                        : field.format === 'uri'
                          ? 'url'
                          : 'text'
                  }
                  required={field.required}
                  inputMode={field.format === 'uri' ? 'url' : undefined}
                  autoComplete={field.secret ? 'new-password' : 'off'}
                  value={values[field.name] ?? ''}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                  className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden focus:ring-2 focus:ring-state-accent-solid"
                />
              )}
              {field.description && (
                <span className="mt-1 block system-xs-regular text-text-tertiary">
                  {field.description}
                </span>
              )}
            </label>
          )
        })}
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
  provider,
}: {
  knowledgeSpaceId: string
  onConnected: (connection: Connection) => void
  provider: Provider
}) {
  const { t } = useTranslation('dataset')
  const [configuring, setConfiguring] = useState(false)

  if (configuring)
    return (
      <ConnectionForm
        knowledgeSpaceId={knowledgeSpaceId}
        onConnected={onConnected}
        provider={provider}
      />
    )

  return (
    <div className="rounded-xl bg-background-section p-4">
      <span className="flex size-9 items-center justify-center rounded-lg border border-divider-subtle bg-background-default">
        <span aria-hidden className="i-ri-fire-line size-[18px] text-text-tertiary" />
      </span>
      <h3 className="mt-3 system-sm-semibold text-text-primary">
        {t(($) => $['newKnowledge.providerNotConfigured'], { provider: provider.displayName })}
      </h3>
      <p className="mt-1 system-xs-regular text-text-tertiary">
        {t(($) => $['newKnowledge.providerNotConfiguredDescription'], {
          provider: provider.displayName,
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
}: {
  connection: Connection
  knowledgeSpaceId: string
  onConnected: (connection: Connection) => void
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
      setError(true)
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

export function AddSourcePage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const providersQuery = useQuery(
    consoleQuery.knowledgeFs.getSourceProviders.queryOptions({ input: {} }),
  )
  const connectionsQuery = useQuery(
    consoleQuery.knowledgeFs.getKnowledgeSpacesByIdSourceConnections.queryOptions({
      input: { params: { id: knowledgeSpaceId }, query: { limit: 200 } },
    }),
  )
  const provider = findFirecrawl(providersQuery.data?.items ?? [])
  const remoteConnection = findProviderConnection(connectionsQuery.data?.items ?? [], provider?.id)
  const [connectionOverride, setConnectionOverride] = useState<Connection>()
  const connection = useMemo(
    () => (connectionOverride?.providerId === provider?.id ? connectionOverride : remoteConnection),
    [connectionOverride, provider?.id, remoteConnection],
  )
  const supportsDirectConnection = provider?.authKinds.some(
    (kind) => kind === 'api-key' || kind === 'endpoint',
  )

  const refreshConnectionState = async () => {
    const refreshed = await connectionsQuery.refetch()
    const updatedConnection = findProviderConnection(refreshed.data?.items ?? [], provider?.id)
    if (updatedConnection) setConnectionOverride(updatedConnection)
  }

  if (providersQuery.isPending || connectionsQuery.isPending)
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Loading />
      </div>
    )

  const queryError = providersQuery.error || connectionsQuery.error

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
        <SourceTypeSelector />
        {provider && (
          <div
            aria-label={provider.displayName}
            className="flex h-9 items-center justify-center gap-2 rounded-lg border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg px-3 system-xs-medium text-text-primary sm:w-40"
          >
            <span aria-hidden className="i-ri-fire-line size-4 text-text-warning" />
            {provider.displayName}
          </div>
        )}
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
            <p className="system-sm-semibold text-text-primary">{provider.displayName}</p>
            <p className="mt-1 system-xs-regular text-text-tertiary">
              {provider.unavailableReason ?? t(($) => $['newKnowledge.providerUnavailable'])}
            </p>
          </div>
        ) : connection?.status === 'active' ? (
          <ProviderConfigured provider={provider} />
        ) : connection?.status === 'provisioning' ? (
          <div className="rounded-xl bg-background-section p-4">
            <p className="system-sm-semibold text-text-primary">
              {t(($) => $['newKnowledge.connectionProvisioning'])}
            </p>
            <Button className="mt-3" onClick={() => void refreshConnectionState()}>
              {t(($) => $['newKnowledge.refreshConnectionStatus'])}
            </Button>
          </div>
        ) : connection ? (
          <ConnectionProblem
            connection={connection}
            knowledgeSpaceId={knowledgeSpaceId}
            onConnected={setConnectionOverride}
          />
        ) : (
          <UnconfiguredProvider
            knowledgeSpaceId={knowledgeSpaceId}
            onConnected={setConnectionOverride}
            provider={provider}
          />
        )}
        <div className="flex justify-end border-t border-divider-subtle pt-5">
          <Link
            href={newKnowledgeDetailPath(knowledgeSpaceId)}
            className="inline-flex h-8 items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3.5 system-sm-medium text-components-button-secondary-text shadow-xs outline-hidden hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            {t(($) => $['newKnowledge.cancelAddSource'])}
          </Link>
        </div>
      </div>
    </main>
  )
}
