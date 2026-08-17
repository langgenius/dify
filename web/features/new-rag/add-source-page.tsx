'use client'

import type { DatasourceProviderAuthListResponse } from '@dify/contracts/api/console/auth/types.gen'
import type { NewKnowledgeSourceDraft, NewKnowledgeSourceType } from './routes'
import type { SourceConnection as Connection, SourceProvider as Provider } from './source-models'
import type { InstalledSourceProviderOption, SourceProviderOption } from './source-provider-options'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldControl, FieldDescription, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Form } from '@langgenius/dify-ui/form'
import { Radio, RadioGroup } from '@langgenius/dify-ui/radio'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { useDataSourceList } from '@/service/use-pipeline'
import { AddSourceExitDialog } from './components/add-source-exit-dialog'
import { ConnectedSourceSetup } from './connected-source-setup'
import {
  datasourceParameterDefaults,
  websiteDatasourceParameterSchemas,
} from './datasource-parameter-model'
import {
  createNewKnowledgeSourceDraft,
  newKnowledgeDetailPath,
  newKnowledgeSourceDraftStorageKey,
  parseNewKnowledgeSourceDraft,
} from './routes'
import {
  sourceConnectionFromApi,
  sourceConnectionListFromApi,
  sourceProviderListFromApi,
} from './source-models'
import {
  discoverSourceProviderOptions,
  sourceProviderOptionForDraft,
} from './source-provider-options'
import {
  SourceProviderIcon,
  SourceProviderNotInstalledCard,
  SourceProviderSelector,
  SourceSyncPolicyField,
  SourceTypeSelector,
} from './source-setup-fields'
import { WebsiteCrawlPreview } from './website-crawl-preview'

type ProviderField = Provider['configuration'][number]
type ConnectionAuthKind = 'api-key' | 'endpoint'
type SourceType = NewKnowledgeSourceType

const CONNECTION_PAGE_SIZE = 200
const WEBSITE_SOURCE_PROVIDER_ID = 'plugin-daemon-website'
const MANAGED_PROVIDER_FIELD_NAMES = new Set([
  'credentialId',
  'datasource',
  'pluginId',
  'provider',
  'providerKind',
])
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

function websiteProviderIntegrationPath(provider?: SourceProviderOption) {
  const base = buildIntegrationPath('data-source')
  if (!provider) return base
  const query = new URLSearchParams({ 'package-ids': JSON.stringify([provider.packageId]) })
  return `${base}?${query.toString()}`
}

function findWebsiteSourceProvider(providers: Provider[]) {
  return providers.find((provider) => provider.id === WEBSITE_SOURCE_PROVIDER_ID)
}

type WebsiteDatasourceProvider = InstalledSourceProviderOption

function findDatasourceAuth(
  providers: DatasourceProviderAuthListResponse['result'],
  datasourceProvider: WebsiteDatasourceProvider | undefined,
) {
  if (!datasourceProvider) return undefined
  return providers.find(
    (provider) =>
      provider.plugin_id === datasourceProvider.plugin.plugin_id &&
      provider.provider === datasourceProvider.plugin.provider,
  )
}

function findDatasourceCredential(
  providers: DatasourceProviderAuthListResponse['result'],
  datasourceProvider: WebsiteDatasourceProvider | undefined,
) {
  const provider = findDatasourceAuth(providers, datasourceProvider)
  return (
    provider?.credentials_list.find((credential) => credential.is_default) ??
    provider?.credentials_list[0]
  )
}

function websiteDatasourceConfiguration(
  datasourceProvider: WebsiteDatasourceProvider,
  credentialId?: string,
) {
  return {
    ...(credentialId ? { credentialId } : {}),
    datasource: datasourceProvider.datasource.identity.name,
    pluginId: datasourceProvider.plugin.plugin_id,
    provider: datasourceProvider.plugin.provider,
    providerKind: 'website',
  }
}

function connectionMatchesDatasource(
  connection: Connection,
  datasourceProvider: WebsiteDatasourceProvider | undefined,
  credentialId?: string,
) {
  if (!datasourceProvider) return false
  const configuration = connection.configuration
  return (
    configuration.pluginId === datasourceProvider.plugin.plugin_id &&
    configuration.provider === datasourceProvider.plugin.provider &&
    configuration.datasource === datasourceProvider.datasource.identity.name &&
    (!credentialId || configuration.credentialId === credentialId)
  )
}

function findProviderConnection(
  connections: Connection[],
  providerId: string | undefined,
  datasourceProvider: WebsiteDatasourceProvider | undefined,
  credentialId?: string,
) {
  if (!providerId || !datasourceProvider) return undefined
  return [
    ...connections.filter(
      (connection) =>
        connection.providerId === providerId &&
        connection.status !== 'revoked' &&
        connectionMatchesDatasource(connection, datasourceProvider, credentialId),
    ),
  ].sort(
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

function normalizeSourceType(value: string | null): SourceType {
  if (value === 'onlineDocuments' || value === 'onlineDrive') return value
  return 'websiteCrawl'
}

function isDifyManagedProvider(provider: Provider) {
  const fieldNames = new Set(provider.configuration.map((field) => field.name))
  return [...MANAGED_PROVIDER_FIELD_NAMES].every((field) => fieldNames.has(field))
}

function getSupportedAuthKinds(provider: Provider, credentialId?: string) {
  if (isDifyManagedProvider(provider))
    return credentialId && provider.authKinds.includes('endpoint')
      ? (['endpoint'] satisfies ConnectionAuthKind[])
      : []

  const fields = provider.configuration.filter(
    (field) => !MANAGED_PROVIDER_FIELD_NAMES.has(field.name),
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
  const descriptionId = field.description ? `${generatedId}-description` : undefined
  const label = humanizeFieldName(field.name)
  const value = values[field.name] ?? ''
  const setValue = (nextValue: string) =>
    setValues((current) => ({ ...current, [field.name]: nextValue }))

  return (
    <Field name={field.name} className="gap-1.5">
      {field.type === 'boolean' ? (
        <Select<'true' | 'false' | null>
          name={field.name}
          required={field.required}
          value={value === 'true' || value === 'false' ? value : null}
          onValueChange={(nextValue) => setValue(nextValue ?? '')}
        >
          <SelectLabel>
            {label}
            {field.required && <span className="ml-0.5 text-text-destructive">*</span>}
          </SelectLabel>
          <SelectTrigger aria-describedby={descriptionId} size="large">
            {value === 'true'
              ? t(($) => $['newKnowledge.booleanTrue'])
              : value === 'false'
                ? t(($) => $['newKnowledge.booleanFalse'])
                : '—'}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={null}>
              <SelectItemText>—</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
            <SelectItem value="true">
              <SelectItemText>{t(($) => $['newKnowledge.booleanTrue'])}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
            <SelectItem value="false">
              <SelectItemText>{t(($) => $['newKnowledge.booleanFalse'])}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <>
          <FieldLabel>
            {label}
            {field.required && <span className="ml-0.5 text-text-destructive">*</span>}
          </FieldLabel>
          <FieldControl
            aria-describedby={descriptionId}
            required={field.required}
            value={value}
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
            size="large"
            onValueChange={setValue}
          />
        </>
      )}
      {field.description && (
        <FieldDescription id={descriptionId}>{field.description}</FieldDescription>
      )}
    </Field>
  )
}

function ConnectionForm({
  datasourceProvider,
  knowledgeSpaceId,
  onConnected,
  onDraftChange,
  onReconcile,
  provider,
  providerName,
  credentialId,
}: {
  datasourceProvider: WebsiteDatasourceProvider
  knowledgeSpaceId: string
  onConnected: (connection: Connection) => void
  onDraftChange: (dirty: boolean) => void
  onReconcile: () => Promise<Connection | undefined>
  provider: Provider
  providerName: string
  credentialId?: string
}) {
  const { t } = useTranslation('dataset')
  const supportedAuthKinds = getSupportedAuthKinds(provider, credentialId)
  const [authKind, setAuthKind] = useState<ConnectionAuthKind>(supportedAuthKinds[0] ?? 'api-key')
  const [configuration, setConfiguration] = useState<Record<string, string>>({})
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [error, setError] = useState(false)
  const [pending, setPending] = useState(false)
  const configurableFields = provider.configuration.filter(
    (field) => !MANAGED_PROVIDER_FIELD_NAMES.has(field.name),
  )
  const visibleFields = configurableFields.filter(
    (field) => authKind === 'api-key' || (!field.secret && field.format === 'uri'),
  )
  const hasDraftChanges =
    authKind !== (supportedAuthKinds[0] ?? 'api-key') ||
    Object.values(configuration).some((value) => Boolean(value.trim())) ||
    Object.values(credentials).some((value) => Boolean(value.trim()))

  useEffect(() => {
    onDraftChange(hasDraftChanges)
    return () => onDraftChange(false)
  }, [hasDraftChanges, onDraftChange])

  const changeAuthKind = (nextAuthKind: ConnectionAuthKind) => {
    if (nextAuthKind !== authKind) setCredentials({})
    setAuthKind(nextAuthKind)
  }

  const handleSubmit = async () => {
    if (pending) return

    const missingRequiredField = visibleFields.some((field) => {
      const values = field.secret ? credentials : configuration
      return field.required && !values[field.name]?.trim()
    })
    if (missingRequiredField) return

    setError(false)
    setPending(true)
    try {
      const fixedValues: Record<string, string> = {
        ...websiteDatasourceConfiguration(datasourceProvider, credentialId),
      }
      const fixedConfiguration = Object.fromEntries(
        provider.configuration
          .filter((field) => MANAGED_PROVIDER_FIELD_NAMES.has(field.name))
          .flatMap((field) => {
            const value = fixedValues[field.name]
            return value === undefined ? [] : ([[field.name, value]] as const)
          }),
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
      const createdConnection = sourceConnectionFromApi(
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceConnections.post({
          body: {
            authKind,
            configuration: safeConfiguration,
            credentials: secretCredentials,
            name: providerName,
            providerId: provider.id,
          },
          params: { control_space_id: knowledgeSpaceId },
        }),
      )
      setCredentials({})
      onDraftChange(false)
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
    <Form className="rounded-xl bg-background-section p-4" onFormSubmit={() => void handleSubmit()}>
      {supportedAuthKinds.length > 1 && (
        <Fieldset className="mb-4">
          <FieldsetLegend className="mb-1.5 py-0 system-xs-medium">
            {t(($) => $['newKnowledge.authenticationMethod'])}
          </FieldsetLegend>
          <RadioGroup<ConnectionAuthKind>
            name="auth-kind"
            value={authKind}
            onValueChange={changeAuthKind}
          >
            {supportedAuthKinds.map((kind) => (
              <label
                key={kind}
                className="flex items-center gap-1.5 system-xs-regular text-text-secondary"
              >
                <Radio<ConnectionAuthKind> value={kind} />
                {t(($) => $[`newKnowledge.authKind.${kind}`])}
              </label>
            ))}
          </RadioGroup>
        </Fieldset>
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
      <Button type="submit" variant="primary" className="mt-4" loading={pending}>
        {pending
          ? t(($) => $['newKnowledge.connectingProvider'])
          : t(($) => $['newKnowledge.connectProvider'], {
              provider: providerName,
            })}
      </Button>
    </Form>
  )
}

function ManagedProviderConnection({
  credentialId,
  datasourceProvider,
  knowledgeSpaceId,
  onConnected,
  onReconcile,
  provider,
  providerName,
}: {
  credentialId: string
  datasourceProvider: WebsiteDatasourceProvider
  knowledgeSpaceId: string
  onConnected: (connection: Connection) => void
  onReconcile: () => Promise<Connection | undefined>
  provider: Provider
  providerName: string
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState(false)
  const requestRef = useRef<
    | {
        key: string
        promise: Promise<Connection | undefined>
      }
    | undefined
  >(undefined)
  const requestKey = `${provider.id}:${datasourceProvider.plugin.plugin_id}:${datasourceProvider.datasource.identity.name}:${credentialId}:${attempt}`

  useEffect(() => {
    if (requestRef.current?.key !== requestKey) {
      requestRef.current = {
        key: requestKey,
        promise: (async () => {
          try {
            return sourceConnectionFromApi(
              await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceConnections.post({
                body: {
                  authKind: 'endpoint',
                  configuration: {
                    ...websiteDatasourceConfiguration(datasourceProvider, credentialId),
                  },
                  credentials: {},
                  name: providerName,
                  providerId: provider.id,
                },
                params: { control_space_id: knowledgeSpaceId },
              }),
            )
          } catch {
            return onReconcile()
          }
        })(),
      }
    }

    let subscribed = true
    void requestRef.current.promise
      .then((connection) => {
        if (!subscribed) return
        if (connection) onConnected(connection)
        else setError(true)
      })
      .catch(() => {
        if (subscribed) setError(true)
      })
    return () => {
      subscribed = false
    }
  }, [
    credentialId,
    datasourceProvider,
    knowledgeSpaceId,
    onConnected,
    onReconcile,
    provider.id,
    providerName,
    requestKey,
  ])

  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-xl bg-background-section p-4 text-center">
      {error ? (
        <>
          <span aria-hidden className="i-ri-error-warning-line size-5 text-text-destructive" />
          <p role="alert" className="mt-2 system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.connectionFailed'])}
          </p>
          <Button
            className="mt-3"
            onClick={() => {
              requestRef.current = undefined
              setError(false)
              setAttempt((current) => current + 1)
            }}
          >
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </>
      ) : (
        <>
          <Loading />
          <p role="status" className="mt-3 system-xs-medium text-text-secondary">
            {t(($) => $['newKnowledge.connectingProvider'])}
          </p>
        </>
      )}
    </div>
  )
}

function UnconfiguredProvider({
  datasourceProvider,
  knowledgeSpaceId,
  onConnected,
  onConfigureManagedProvider,
  onDraftChange,
  onReconcile,
  provider,
  providerOption,
  providerName,
  credentialId,
}: {
  datasourceProvider: WebsiteDatasourceProvider
  knowledgeSpaceId: string
  onConnected: (connection: Connection) => void
  onConfigureManagedProvider: () => void
  onDraftChange: (dirty: boolean) => void
  onReconcile: () => Promise<Connection | undefined>
  provider: Provider
  providerOption: InstalledSourceProviderOption
  providerName: string
  credentialId?: string
}) {
  const { t } = useTranslation('dataset')
  const [configuring, setConfiguring] = useState(false)
  const difyManaged = isDifyManagedProvider(provider)

  if (difyManaged && credentialId)
    return (
      <ManagedProviderConnection
        credentialId={credentialId}
        datasourceProvider={datasourceProvider}
        knowledgeSpaceId={knowledgeSpaceId}
        onConnected={onConnected}
        onReconcile={onReconcile}
        provider={provider}
        providerName={providerName}
      />
    )

  if (configuring)
    return (
      <ConnectionForm
        datasourceProvider={datasourceProvider}
        knowledgeSpaceId={knowledgeSpaceId}
        onConnected={onConnected}
        onDraftChange={onDraftChange}
        onReconcile={onReconcile}
        provider={provider}
        providerName={providerName}
      />
    )

  return (
    <div className="flex flex-col items-start gap-2.5 rounded-xl bg-background-section p-4">
      <span className="flex size-9 items-center justify-center rounded-lg border border-divider-subtle bg-background-default">
        <SourceProviderIcon
          fallbackIcon={providerOption.fallbackIcon}
          icon={
            providerOption.installed
              ? (providerOption.datasource.identity.icon ??
                providerOption.plugin.declaration.identity.icon)
              : undefined
          }
        />
      </span>
      <h3 className="system-sm-semibold text-text-primary">
        {t(($) => $['newKnowledge.providerNotConfigured'], {
          provider: providerName,
        })}
      </h3>
      <p className="system-xs-regular text-text-tertiary">
        {t(($) => $['newKnowledge.providerNotConfiguredDescription'], {
          provider: providerName,
        })}
      </p>
      <Button
        variant="primary"
        onClick={() => (difyManaged ? onConfigureManagedProvider() : setConfiguring(true))}
      >
        {t(($) => $['newKnowledge.configureProvider'], {
          provider: providerName,
        })}
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
      const refreshed = sourceConnectionFromApi(
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceConnections.byConnectionId.refresh.post(
          {
            body: { expectedVersion: connection.version },
            params: {
              connection_id: connection.id,
              control_space_id: knowledgeSpaceId,
            },
          },
        ),
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

export function AddSourcePage({
  initialSourceDraft,
  initialSourceProvider,
  initialSourceType,
  knowledgeSpaceId,
  sourceDraftKey,
}: {
  initialSourceDraft?: NewKnowledgeSourceDraft
  initialSourceProvider?: string
  initialSourceType?: string
  knowledgeSpaceId: string
  sourceDraftKey?: string
}) {
  const { t } = useTranslation('dataset')
  const router = useRouter()
  const queryClient = useQueryClient()
  const initialDraftRef = useRef<NewKnowledgeSourceDraft>(
    initialSourceDraft ??
      createNewKnowledgeSourceDraft(
        normalizeSourceType(initialSourceType ?? null),
        initialSourceProvider,
      ),
  )
  const [sourceDraft, setSourceDraft] = useState<NewKnowledgeSourceDraft>(initialDraftRef.current)
  const sourceDraftBaselineRef = useRef(
    JSON.stringify(
      initialSourceProvider && !initialSourceDraft
        ? initialDraftRef.current
        : createNewKnowledgeSourceDraft(initialDraftRef.current.sourceType),
    ),
  )
  const [sourceDraftResolved, setSourceDraftResolved] = useState(!sourceDraftKey)
  const [connectionDraftDirty, setConnectionDraftDirty] = useState(false)
  const [exitOpen, setExitOpen] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [discardError, setDiscardError] = useState(false)
  const [websiteSetupLocked, setWebsiteSetupLocked] = useState(false)
  const [historyGuardReleaseVersion, setHistoryGuardReleaseVersion] = useState(0)
  const historyGuardArmedRef = useRef(false)
  const historyGuardReleaseRef = useRef(false)
  const browserBackExitRef = useRef(false)
  const pendingNavigationRef = useRef<string | undefined>(undefined)
  const exitDestinationRef = useRef(newKnowledgeDetailPath(knowledgeSpaceId))
  const sourceDraftsRef = useRef<
    Partial<Record<NewKnowledgeSourceDraft['sourceType'], NewKnowledgeSourceDraft>>
  >({ [sourceDraft.sourceType]: sourceDraft })
  const sourceType = sourceDraft.sourceType
  const websiteSourceSelected = sourceDraft.sourceType === 'websiteCrawl'
  const detailPath = newKnowledgeDetailPath(knowledgeSpaceId)
  const updateSourceDraft = (draft: NewKnowledgeSourceDraft) => {
    sourceDraftsRef.current[draft.sourceType] = draft
    setSourceDraft(draft)
  }

  useEffect(() => {
    if (!sourceDraftKey) return undefined
    let active = true
    globalThis.queueMicrotask(() => {
      if (!active) return
      let draft: NewKnowledgeSourceDraft | undefined
      try {
        const storageKey = newKnowledgeSourceDraftStorageKey(sourceDraftKey)
        const storedDraft = globalThis.sessionStorage.getItem(storageKey)
        if (storedDraft) draft = parseNewKnowledgeSourceDraft(storedDraft)
      } catch {
        // Continue without the optional draft when browser storage is unavailable.
      }
      if (active) {
        const nextDraft =
          draft ??
          createNewKnowledgeSourceDraft(
            normalizeSourceType(initialSourceType ?? null),
            initialSourceProvider,
          )
        sourceDraftsRef.current[nextDraft.sourceType] = nextDraft
        setSourceDraft(nextDraft)
        setSourceDraftResolved(true)
      }
    })
    return () => {
      active = false
    }
  }, [initialSourceProvider, initialSourceType, sourceDraftKey])
  const clearStoredSourceDraft = useCallback(() => {
    if (!sourceDraftKey) return
    try {
      globalThis.sessionStorage.removeItem(newKnowledgeSourceDraftStorageKey(sourceDraftKey))
    } catch {
      // The draft remains scoped to this browser session when storage cleanup is unavailable.
    }
  }, [sourceDraftKey])
  const providersQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.sourceProviders.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
      context: { silent: true },
      enabled: websiteSourceSelected,
      retry: false,
      select: sourceProviderListFromApi,
    }),
  )
  const datasourceAuthQuery = useQuery(
    consoleQuery.auth.plugin.datasource.defaultList.get.queryOptions({
      context: { silent: true },
      enabled: websiteSourceSelected,
      retry: false,
    }),
  )
  const datasourcePluginsQuery = useDataSourceList(websiteSourceSelected)
  const connectionsQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.sourceConnections.get.infiniteOptions({
      context: { silent: true },
      enabled: websiteSourceSelected,
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          limit: CONNECTION_PAGE_SIZE,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor,
      initialPageParam: null as string | null,
      retry: false,
    }),
  )
  const provider = findWebsiteSourceProvider(providersQuery.data ?? [])
  const websiteProviderOptions = useMemo(
    () => discoverSourceProviderOptions('websiteCrawl', datasourcePluginsQuery.data ?? []),
    [datasourcePluginsQuery.data],
  )
  const websiteProviderOption = sourceProviderOptionForDraft(websiteProviderOptions, sourceDraft)
  const websiteProviderName = websiteProviderOption?.label ?? sourceDraft.provider
  const datasourceProvider = websiteProviderOption?.installed ? websiteProviderOption : undefined
  const datasourceProviders = datasourceAuthQuery.data?.result ?? []
  const datasourceCredential = findDatasourceCredential(datasourceProviders, datasourceProvider)
  const difyManagedProvider = provider ? isDifyManagedProvider(provider) : false
  const remoteConnections =
    connectionsQuery.data?.pages.flatMap((page) => sourceConnectionListFromApi(page).items) ?? []
  const remoteConnection = findProviderConnection(
    remoteConnections,
    provider?.id,
    datasourceProvider,
    difyManagedProvider ? datasourceCredential?.id : undefined,
  )
  const [connectionOverride, setConnectionOverride] = useState<Connection>()
  const matchingRemoteConnection = connectionOverride
    ? remoteConnections.find((candidate) => candidate.id === connectionOverride.id)
    : undefined
  const connection = useMemo(() => {
    const localConnection = connectionOverride
    if (
      !localConnection ||
      localConnection.providerId !== provider?.id ||
      !connectionMatchesDatasource(
        localConnection,
        datasourceProvider,
        difyManagedProvider ? datasourceCredential?.id : undefined,
      )
    )
      return remoteConnection
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
  }, [
    connectionOverride,
    datasourceCredential?.id,
    datasourceProvider,
    difyManagedProvider,
    matchingRemoteConnection,
    provider?.id,
    remoteConnection,
  ])
  const activeConnection =
    connection?.status === 'active' &&
    (!difyManagedProvider || datasourceCredential?.id === connection.configuration.credentialId)
      ? connection
      : undefined
  const supportsDirectConnection = provider
    ? difyManagedProvider
      ? Boolean(datasourceProvider) && provider.authKinds.includes('endpoint')
      : getSupportedAuthKinds(provider).length > 0
    : false
  const {
    fetchNextPage: fetchNextConnectionPage,
    hasNextPage: hasNextConnectionPage,
    isFetchingNextPage: isFetchingNextConnectionPage,
    refetch: refetchConnections,
  } = connectionsQuery
  const { refetch: refetchProviders } = providersQuery
  const { refetch: refetchDatasourceAuth } = datasourceAuthQuery
  const { refetch: refetchDatasourcePlugins } = datasourcePluginsQuery

  useEffect(() => {
    if (!websiteSourceSelected) return
    const refetch = () => {
      void Promise.all([
        refetchProviders(),
        refetchDatasourcePlugins(),
        refetchDatasourceAuth(),
        refetchConnections(),
      ])
    }
    globalThis.addEventListener('focus', refetch)
    return () => globalThis.removeEventListener('focus', refetch)
  }, [
    refetchConnections,
    refetchDatasourceAuth,
    refetchDatasourcePlugins,
    refetchProviders,
    websiteSourceSelected,
  ])

  useEffect(() => {
    if (
      websiteSourceSelected &&
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
    websiteSourceSelected,
  ])

  const rememberConnection = useCallback(
    (updatedConnection: Connection) => {
      setConnectionOverride(updatedConnection)
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sourceConnections.get.key(),
      })
    },
    [queryClient],
  )

  const reconcileConnection = useCallback(async () => {
    if (connection) setConnectionOverride(connection)
    const refreshed = await refetchConnections()
    if (refreshed.error) throw refreshed.error
    const refreshedConnections =
      refreshed.data?.pages.flatMap((page) => sourceConnectionListFromApi(page).items) ?? []
    const refreshedCurrentConnection = connection
      ? findConnectionById(refreshedConnections, connection.id)
      : undefined
    const updatedConnection = connection
      ? refreshedCurrentConnection
        ? findConnectionById([connection, refreshedCurrentConnection], connection.id)
        : undefined
      : findProviderConnection(
          refreshedConnections,
          provider?.id,
          datasourceProvider,
          difyManagedProvider ? datasourceCredential?.id : undefined,
        )
    if (updatedConnection) setConnectionOverride(updatedConnection)
    return updatedConnection
  }, [
    connection,
    datasourceCredential?.id,
    datasourceProvider,
    difyManagedProvider,
    provider?.id,
    refetchConnections,
  ])

  const loadingConnections =
    connectionsQuery.isPending ||
    (!connectionsQuery.isFetchNextPageError &&
      (connectionsQuery.hasNextPage || connectionsQuery.isFetchingNextPage))
  const queryError =
    providersQuery.error ||
    datasourcePluginsQuery.error ||
    connectionsQuery.error ||
    connectionsQuery.isFetchNextPageError ||
    (difyManagedProvider ? datasourceAuthQuery.error : null)
  const websiteReady = Boolean(
    websiteSourceSelected &&
    !queryError &&
    Boolean(datasourceProvider) &&
    provider?.available &&
    supportsDirectConnection &&
    activeConnection,
  )
  const websitePreviewReady =
    sourceDraftResolved &&
    websiteReady &&
    !historyGuardArmedRef.current &&
    !historyGuardReleaseRef.current
  const hasUnsavedChanges =
    sourceDraftResolved &&
    !websiteReady &&
    (connectionDraftDirty || JSON.stringify(sourceDraft) !== sourceDraftBaselineRef.current)
  const armHistoryGuard = useCallback(() => {
    globalThis.history.pushState(globalThis.history.state, '', globalThis.location.href)
    historyGuardArmedRef.current = true
  }, [])
  const replaceAfterHistoryGuard = useCallback(
    (path: string) => {
      if (!historyGuardArmedRef.current) {
        router.replace(path)
        return
      }
      pendingNavigationRef.current = path
      globalThis.history.back()
    },
    [router],
  )
  const requestNavigation = useCallback(
    (path: string) => {
      if (discarding) return
      if (hasUnsavedChanges) {
        exitDestinationRef.current = path
        browserBackExitRef.current = false
        setDiscardError(false)
        setExitOpen(true)
        return
      }
      clearStoredSourceDraft()
      replaceAfterHistoryGuard(path)
    },
    [clearStoredSourceDraft, discarding, hasUnsavedChanges, replaceAfterHistoryGuard],
  )

  useEffect(() => {
    if (
      !hasUnsavedChanges ||
      historyGuardArmedRef.current ||
      browserBackExitRef.current ||
      pendingNavigationRef.current
    )
      return
    armHistoryGuard()
  }, [armHistoryGuard, hasUnsavedChanges])

  useEffect(() => {
    const handlePopState = () => {
      if (!historyGuardArmedRef.current) return
      historyGuardArmedRef.current = false
      if (historyGuardReleaseRef.current) {
        historyGuardReleaseRef.current = false
        setHistoryGuardReleaseVersion((version) => version + 1)
        return
      }
      const pendingNavigation = pendingNavigationRef.current
      if (pendingNavigation) {
        pendingNavigationRef.current = undefined
        router.replace(pendingNavigation)
        return
      }
      if (!hasUnsavedChanges) {
        clearStoredSourceDraft()
        router.replace(detailPath)
        return
      }
      browserBackExitRef.current = true
      exitDestinationRef.current = detailPath
      setDiscardError(false)
      setExitOpen(true)
    }

    globalThis.addEventListener('popstate', handlePopState)
    return () => globalThis.removeEventListener('popstate', handlePopState)
  }, [clearStoredSourceDraft, detailPath, hasUnsavedChanges, router])

  useEffect(() => {
    if (
      !websiteReady ||
      !historyGuardArmedRef.current ||
      historyGuardReleaseRef.current ||
      pendingNavigationRef.current
    )
      return
    historyGuardReleaseRef.current = true
    globalThis.history.back()
  }, [websiteReady])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    globalThis.addEventListener('beforeunload', handleBeforeUnload)
    return () => globalThis.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const anchor = event
        .composedPath()
        .find((target): target is HTMLAnchorElement => target instanceof HTMLAnchorElement)
      if (
        !anchor ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self')
      )
        return
      const destination = new URL(anchor.href, globalThis.location.href)
      if (destination.origin !== globalThis.location.origin) return
      const current = new URL(globalThis.location.href)
      if (destination.pathname === current.pathname && destination.search === current.search) return
      event.preventDefault()
      requestNavigation(`${destination.pathname}${destination.search}${destination.hash}`)
    }

    document.addEventListener('click', handleDocumentClick, true)
    return () => document.removeEventListener('click', handleDocumentClick, true)
  }, [hasUnsavedChanges, requestNavigation])

  const requestExit = () => requestNavigation(detailPath)
  const cancelExit = () => {
    setExitOpen(false)
    setDiscardError(false)
    if (!browserBackExitRef.current) return
    browserBackExitRef.current = false
    armHistoryGuard()
  }
  const confirmExit = () => {
    if (discarding) return
    setDiscarding(true)
    setDiscardError(false)
    try {
      clearStoredSourceDraft()
      sourceDraftBaselineRef.current = JSON.stringify(sourceDraft)
      setConnectionDraftDirty(false)
      setExitOpen(false)
      browserBackExitRef.current = false
      const destination = exitDestinationRef.current
      exitDestinationRef.current = detailPath
      replaceAfterHistoryGuard(destination)
    } catch {
      setDiscardError(true)
    } finally {
      setDiscarding(false)
    }
  }

  if (
    !sourceDraftResolved ||
    (websiteSourceSelected &&
      (providersQuery.isPending ||
        datasourcePluginsQuery.isPending ||
        datasourceAuthQuery.isPending ||
        loadingConnections))
  )
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
        <Loading />
      </div>
    )

  return (
    <>
      <main className="h-full min-h-0 w-full min-w-0 flex-1 overflow-y-auto px-4 pt-3 pb-6 sm:px-8 sm:pb-8">
        <header>
          <h2 className="system-xl-semibold text-text-primary">
            {t(($) => $['newKnowledge.addSource'])}
          </h2>
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.addSourceDescription'])}
          </p>
        </header>
        <div className="mt-4.5 flex w-full max-w-160 flex-col gap-4">
          <SourceTypeSelector
            disabled={websiteSetupLocked}
            value={sourceType}
            onChange={(value) => {
              sourceDraftsRef.current[sourceDraft.sourceType] = sourceDraft
              updateSourceDraft(
                sourceDraftsRef.current[value] ?? createNewKnowledgeSourceDraft(value),
              )
            }}
          />
          {sourceDraft.sourceType === 'websiteCrawl' ? (
            <>
              <SourceProviderSelector
                disabled={websiteSetupLocked}
                options={websiteProviderOptions}
                providerKey={websiteProviderOption?.key ?? ''}
                onMoreProviders={() =>
                  globalThis.open(websiteProviderIntegrationPath(), '_blank', 'noopener,noreferrer')
                }
                onChange={(providerKey) => {
                  const nextProvider = websiteProviderOptions.find(
                    (option) => option.key === providerKey,
                  )
                  if (!nextProvider) return
                  updateSourceDraft({
                    ...sourceDraft,
                    parameters: nextProvider.installed
                      ? datasourceParameterDefaults(
                          websiteDatasourceParameterSchemas(nextProvider.datasource),
                        )
                      : {},
                    provider: nextProvider.label,
                    providerKey: nextProvider.key,
                    rootUrl: '',
                  })
                }}
              />
              <SourceSyncPolicyField
                className="w-full sm:w-75.25"
                draft={sourceDraft}
                size="medium"
                onDraftChange={updateSourceDraft}
              />
              {queryError ? (
                <div className="rounded-xl bg-background-section p-4">
                  <p className="system-sm-semibold text-text-primary">
                    {t(($) => $['newKnowledge.providerLoadFailed'])}
                  </p>
                  <Button
                    className="mt-3"
                    onClick={() =>
                      void Promise.all([
                        providersQuery.refetch(),
                        datasourcePluginsQuery.refetch(),
                        datasourceAuthQuery.refetch(),
                        connectionsQuery.refetch(),
                      ])
                    }
                  >
                    {t(($) => $['newKnowledge.retryProviderLoad'])}
                  </Button>
                </div>
              ) : websiteProviderOption && !websiteProviderOption.installed ? (
                <SourceProviderNotInstalledCard
                  icon={<SourceProviderIcon fallbackIcon={websiteProviderOption.fallbackIcon} />}
                  provider={websiteProviderOption.label}
                  onInstall={() =>
                    globalThis.open(
                      websiteProviderIntegrationPath(websiteProviderOption),
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                />
              ) : !datasourceProvider || !provider ? (
                <div className="rounded-xl bg-background-section p-4 system-sm-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.providerUnavailable'])}
                </div>
              ) : !provider.available || !supportsDirectConnection ? (
                <div className="rounded-xl bg-background-section p-4">
                  <p className="system-sm-semibold text-text-primary">{websiteProviderName}</p>
                  <p className="mt-1 system-xs-regular text-text-tertiary">
                    {provider.unavailableReason ?? t(($) => $['newKnowledge.providerUnavailable'])}
                  </p>
                </div>
              ) : activeConnection && websitePreviewReady ? (
                <WebsiteCrawlPreview
                  key={`${historyGuardReleaseVersion}:${datasourceProvider.key}:${activeConnection.id}`}
                  connection={activeConnection}
                  initialDraft={sourceDraft}
                  knowledgeSpaceId={knowledgeSpaceId}
                  onDraftFinished={clearStoredSourceDraft}
                  onInteractionLockChange={setWebsiteSetupLocked}
                  providerName={websiteProviderName}
                  providerOption={datasourceProvider}
                />
              ) : activeConnection ? (
                <div className="flex min-h-64 items-center justify-center">
                  <Loading />
                </div>
              ) : connection?.status === 'provisioning' ? (
                <ProvisioningConnection onReconcile={reconcileConnection} />
              ) : connection && connection.status !== 'active' ? (
                <ConnectionProblem
                  connection={connection}
                  knowledgeSpaceId={knowledgeSpaceId}
                  onConnected={rememberConnection}
                  onReconcile={reconcileConnection}
                />
              ) : (
                <UnconfiguredProvider
                  key={`${websiteProviderName}:${datasourceProvider.plugin.plugin_id}`}
                  credentialId={datasourceCredential?.id}
                  datasourceProvider={datasourceProvider}
                  knowledgeSpaceId={knowledgeSpaceId}
                  onConnected={rememberConnection}
                  onConfigureManagedProvider={() =>
                    globalThis.open(
                      websiteProviderIntegrationPath(websiteProviderOption),
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                  onDraftChange={setConnectionDraftDirty}
                  onReconcile={reconcileConnection}
                  provider={provider}
                  providerOption={datasourceProvider}
                  providerName={websiteProviderName}
                />
              )}
            </>
          ) : (
            <ConnectedSourceSetup
              draft={sourceDraft}
              knowledgeSpaceId={knowledgeSpaceId}
              onCompleted={() => {
                clearStoredSourceDraft()
                sourceDraftBaselineRef.current = JSON.stringify(sourceDraft)
                setConnectionDraftDirty(false)
                replaceAfterHistoryGuard(detailPath)
              }}
              onDraftChange={(draft) => {
                updateSourceDraft(draft)
              }}
              onDirtyChange={setConnectionDraftDirty}
              onExit={requestExit}
            />
          )}
          {sourceType === 'websiteCrawl' && !websiteReady && (
            <div className="flex justify-end gap-2 border-t border-divider-subtle pt-5">
              <Button type="button" onClick={requestExit}>
                {t(($) => $['newKnowledge.cancelAddSource'])}
              </Button>
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
            </div>
          )}
        </div>
      </main>
      <AddSourceExitDialog
        discarding={discarding}
        error={discardError}
        onCancel={cancelExit}
        onConfirm={confirmExit}
        open={exitOpen}
      />
    </>
  )
}
