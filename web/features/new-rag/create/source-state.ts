import type { KnowledgeFsSpaceCreatePayload } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ConnectedSourceSelection } from '../sources/setup/connected-source-selection'
import type { NewKnowledgeSourceDraft } from '../sources/setup/source-draft'
import type { CrawlPreviewPage } from '../sources/source-models'
import type {
  DataSourceAuth,
  DataSourceCredential,
} from '@/app/components/header/account-setting/data-source-page-new/types'
import { atom, useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import { useGetDataSourceListAuth } from '@/service/use-datasource'
import { useDataSourceList } from '@/service/use-pipeline'
import { connectedInitialSource } from '../sources/setup/connected-source-selection'
import {
  datasourceIncludeSubpages,
  datasourceParameterSchemas,
  invalidDatasourceParameters,
  missingRequiredDatasourceParameters,
  websiteDatasourceParameterSchemas,
  withDatasourceParameterDefaults,
} from '../sources/setup/datasource-parameter-model'
import {
  discoverSourceProviderOptions,
  sourceDraftForProviderOption,
  sourceProviderOptionForDraft,
} from '../sources/setup/provider-options'

type InitialSource = NonNullable<KnowledgeFsSpaceCreatePayload['initial_source']>
export type CreateSourceSelection = { sessionKey: string } & (
  | {
      kind: 'website'
      pages: CrawlPreviewPage[]
      previewJobId?: string
      previewConfigurationFingerprint?: string
    }
  | { kind: 'connected'; resources: ConnectedSourceSelection }
)
export const createSourceSelectionAtom = atom<CreateSourceSelection | undefined>(undefined)
function datasourceAuthForProvider(
  authProviders: DataSourceAuth[],
  pluginId: string,
  provider: string,
) {
  return authProviders.find(
    (candidate) => candidate.plugin_id === pluginId && candidate.provider === provider,
  )
}

function preferredCredential(auth?: DataSourceAuth): DataSourceCredential | undefined {
  return (
    auth?.credentials_list.find((credential) => credential.is_default) ?? auth?.credentials_list[0]
  )
}

export function providerIntegrationPath(packageId?: string) {
  const base = buildIntegrationPath('data-source')
  if (!packageId) return base
  const query = new URLSearchParams({ 'package-ids': JSON.stringify([packageId]) })
  return `${base}?${query.toString()}`
}

function websiteSourceUri(parameters: Record<string, boolean | number | string>, fallback: string) {
  const url = parameters.url
  if (typeof url === 'string') {
    try {
      const parsed = new URL(url)
      if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password)
        return parsed.toString()
    } catch {
      // Non-URL website datasources use a stable synthetic URI.
    }
  }
  return `datasource://${encodeURIComponent(fallback)}`
}

export function useSourceSetupInputs(draft: NewKnowledgeSourceDraft, enabled = true) {
  const datasourcePluginsQuery = useDataSourceList(enabled)
  const datasourceAuthQuery = useGetDataSourceListAuth(enabled)
  const providerOptions = useMemo(
    () => discoverSourceProviderOptions(draft.sourceType, datasourcePluginsQuery.data ?? []),
    [datasourcePluginsQuery.data, draft.sourceType],
  )
  const providerOption = sourceProviderOptionForDraft(providerOptions, draft)
  const providerDraft = useMemo(
    () => (providerOption ? sourceDraftForProviderOption(draft, providerOption) : draft),
    [draft, providerOption],
  )
  const datasourceAuth = providerOption
    ? datasourceAuthForProvider(
        datasourceAuthQuery.data?.result ?? [],
        providerOption.plugin.plugin_id,
        providerOption.plugin.provider,
      )
    : undefined
  const credential = preferredCredential(datasourceAuth)
  const sessionKey = [
    draft.sourceType,
    providerOption?.key ?? 'no-provider',
    providerOption?.plugin.plugin_unique_identifier ?? 'no-plugin-version',
    credential?.id ?? 'no-credential',
  ].join(':')

  const installedProviderOption = providerOption
  const parameterSchemas = useMemo(
    () =>
      installedProviderOption
        ? draft.sourceType === 'websiteCrawl'
          ? websiteDatasourceParameterSchemas(installedProviderOption.datasource)
          : datasourceParameterSchemas(installedProviderOption.datasource)
        : [],
    [draft.sourceType, installedProviderOption],
  )
  const parameters = useMemo(() => {
    const current = withDatasourceParameterDefaults(parameterSchemas, providerDraft.parameters)
    if (
      providerDraft.sourceType === 'websiteCrawl' &&
      providerDraft.rootUrl &&
      parameterSchemas.some((parameter) => parameter.name === 'url') &&
      current.url === undefined
    )
      current.url = providerDraft.rootUrl
    return current
  }, [parameterSchemas, providerDraft])
  const parametersValid =
    !missingRequiredDatasourceParameters(parameterSchemas, parameters).length &&
    !invalidDatasourceParameters(parameterSchemas, parameters).length
  const sourceUri = installedProviderOption
    ? websiteSourceUri(parameters, installedProviderOption.key)
    : ''
  return {
    datasourcePluginsQuery,
    datasourceAuthQuery,
    providerOptions,
    providerOption,
    providerDraft,
    credential,
    sessionKey,
    parameterSchemas,
    parameters,
    parametersValid,
    sourceUri,
  }
}

export function useCreateInitialSource(
  draft: NewKnowledgeSourceDraft,
  enabled: boolean,
): InitialSource | undefined {
  const { providerOption, providerDraft, credential, sessionKey, parameters, sourceUri } =
    useSourceSetupInputs(draft, enabled)
  const selection = useAtomValue(createSourceSelectionAtom)
  if (!providerOption || !credential || !selection || selection.sessionKey !== sessionKey)
    return undefined
  const binding = {
    credentialId: credential.id,
    datasource: providerOption.datasource.identity.name,
    pluginId: providerOption.plugin.plugin_id,
    provider: providerOption.plugin.provider,
    providerDisplayName: providerOption.label,
  }
  if (providerDraft.sourceType !== 'websiteCrawl') {
    if (selection.kind !== 'connected') return undefined
    return connectedInitialSource(
      providerDraft,
      binding,
      parameters,
      selection.resources,
      providerOption.providerType === 'online_drive',
    )
  }
  if (selection.kind !== 'website' || !selection.pages.length) return undefined
  return {
    ...binding,
    kind: 'website_crawl',
    name: providerDraft.sourceName.trim(),
    parameters,
    crawl_options: {
      include_subpages: datasourceIncludeSubpages(parameters),
      limit: typeof parameters.limit === 'number' ? parameters.limit : 200,
    },
    previewJobId: selection.previewJobId,
    previewConfigurationFingerprint: selection.previewConfigurationFingerprint,
    root_url: sourceUri,
    selection: selection.pages.map((page) => ({
      pageId: page.pageId,
      source_url: page.sourceUrl,
      ...(page.title ? { title: page.title } : {}),
    })),
    ...(providerDraft.syncPolicy === 'custom' && providerDraft.customIntervalSeconds
      ? { custom_interval_seconds: providerDraft.customIntervalSeconds }
      : {}),
    sync_policy: providerDraft.syncPolicy,
  }
}
