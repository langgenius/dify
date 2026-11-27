import type {
  GetWorkspacesCurrentPluginByCategoryListData,
  PluginCategoryInstalledPluginResponse,
  PluginCategoryListResponse,
  PluginEntity,
  PluginInstallationItemResponse,
  PluginInstallTaskStartResponse,
  PluginListResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'
import type { AutoUpdateConfig } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import type {
  Dependency,
  GitHubItemAndMarketPlaceDependency,
  InstallStatusResponse,
  MetaData,
  PackageDependency,
  Permissions,
  Plugin,
  PluginDeclaration,
  PluginDetail,
  ReferenceSetting,
  VersionInfo,
} from '@/app/components/plugins/types'
import type { Collection } from '@/app/components/tools/types'
import {
  zAgentStrategyProviderEntity,
  zDatasourceProviderEntity,
  zEndpointProviderDeclarationResponse,
} from '@dify/contracts/api/console/workspaces/zod.gen'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cloneDeep } from 'es-toolkit/object'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef } from 'react'
import { FormTypeEnum } from '@/app/components/base/form/types'
import useRefreshPluginList from '@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list'
import { PluginCategoryEnum, PluginSource, TaskStatus } from '@/app/components/plugins/types'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleClient, consoleQuery } from '@/service/console'
import { pluginTaskListInput, upsertStartedPluginTask } from '@/service/console/plugin-task-cache'
import { pluginTaskListQueryOptions } from '@/service/plugin-install-queries'
import { uninstallPlugin } from '@/service/plugins'
import { hasPermission } from '@/utils/permission'

const getString = (value: unknown) => {
  return typeof value === 'string' ? value : ''
}

const getBoolean = (value: unknown) => {
  return value === true
}

const getNumber = (value: unknown) => {
  return typeof value === 'number' ? value : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const getRecord = (value: unknown, key: string) => {
  if (!isRecord(value)) return undefined

  const child = value[key]
  return isRecord(child) ? child : undefined
}

const getRecordArray = (value: unknown, key: string) => {
  if (!isRecord(value)) return []

  const child = value[key]
  return Array.isArray(child) ? child.filter(isRecord) : []
}

const getStringArray = (value: unknown) => {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

const getI18nValue = (value: object | null | undefined, key: string) => {
  return value ? getString(Object.entries(value).find(([itemKey]) => itemKey === key)?.[1]) : ''
}

const normalizeI18nObject = (
  value: object | null | undefined,
  fallback = '',
): PluginDeclaration['label'] => {
  const en = getI18nValue(value, 'en_US') || getI18nValue(value, 'en-US') || fallback
  const zhHans = getI18nValue(value, 'zh_Hans') || getI18nValue(value, 'zh-Hans') || en
  const ja = getI18nValue(value, 'ja_JP') || getI18nValue(value, 'ja-JP') || en
  const ptBr = getI18nValue(value, 'pt_BR') || getI18nValue(value, 'pt-BR') || en

  return {
    'en-US': en,
    'zh-Hans': zhHans,
    'zh-Hant': en,
    'pt-BR': ptBr,
    'es-ES': en,
    'fr-FR': en,
    'de-DE': en,
    'ja-JP': ja,
    'ko-KR': en,
    'ru-RU': en,
    'it-IT': en,
    'th-TH': en,
    'uk-UA': en,
    'vi-VN': en,
    'ro-RO': en,
    'pl-PL': en,
    'hi-IN': en,
    'tr-TR': en,
    'fa-IR': en,
    'sl-SI': en,
    'id-ID': en,
    'nl-NL': en,
    'ar-TN': en,
    'lo-LA': en,
    'az-AZ': en,
    en_US: en,
    zh_Hans: zhHans,
    ja_JP: ja,
    pt_BR: ptBr,
  }
}

const normalizePluginCategory = (
  category: PluginInstallationItemResponse['declaration']['category'],
): PluginCategoryEnum => {
  switch (category) {
    case PluginCategoryEnum.tool:
      return PluginCategoryEnum.tool
    case PluginCategoryEnum.model:
      return PluginCategoryEnum.model
    case PluginCategoryEnum.datasource:
      return PluginCategoryEnum.datasource
    case PluginCategoryEnum.trigger:
      return PluginCategoryEnum.trigger
    case PluginCategoryEnum.agent:
      return PluginCategoryEnum.agent
    case PluginCategoryEnum.extension:
      return PluginCategoryEnum.extension
  }
  return PluginCategoryEnum.extension
}

const normalizePluginSource = (source: PluginInstallationItemResponse['source']): PluginSource => {
  switch (source) {
    case PluginSource.github:
      return PluginSource.github
    case PluginSource.marketplace:
      return PluginSource.marketplace
    case PluginSource.local:
      return PluginSource.local
    case PluginSource.debugging:
      return PluginSource.debugging
  }
  return PluginSource.marketplace
}

const normalizePluginMeta = (meta: Record<string, unknown>): MetaData => {
  return {
    repo: getString(meta.repo),
    version: getString(meta.version),
    package: getString(meta.package),
  }
}

const normalizeToolCredentialOption = (
  option: Record<string, unknown>,
): NonNullable<
  NonNullable<PluginDeclaration['tool']>['credentials_schema'][number]['options']
>[number] => ({
  label: normalizeI18nObject(getRecord(option, 'label'), getString(option.value)),
  value: getString(option.value),
})

const normalizeToolCredential = (
  credential: Record<string, unknown>,
): NonNullable<PluginDeclaration['tool']>['credentials_schema'][number] => ({
  name: getString(credential.name),
  label: normalizeI18nObject(getRecord(credential, 'label'), getString(credential.name)),
  help: credential.help === null ? null : normalizeI18nObject(getRecord(credential, 'help')),
  placeholder: normalizeI18nObject(getRecord(credential, 'placeholder')),
  type: getString(credential.type),
  required: getBoolean(credential.required),
  default: getString(credential.default),
  options: getRecordArray(credential, 'options').map(normalizeToolCredentialOption),
})

const normalizePluginToolDeclaration = (value: unknown): PluginDeclaration['tool'] => {
  if (!isRecord(value)) return undefined

  const identity = getRecord(value, 'identity')
  if (!identity) return undefined

  const name = getString(identity.name)

  return {
    identity: {
      author: getString(identity.author),
      name,
      description: normalizeI18nObject(getRecord(identity, 'description')),
      icon: getString(identity.icon),
      label: normalizeI18nObject(getRecord(identity, 'label'), name),
      tags: getStringArray(identity.tags),
    },
    credentials_schema: getRecordArray(value, 'credentials_schema').map(normalizeToolCredential),
  }
}

const normalizeParameterDefault = (value: unknown) => {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string')
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return undefined
  return String(value)
}

const normalizeFormType = (type: unknown): FormTypeEnum => {
  switch (type) {
    case FormTypeEnum.appSelector:
      return FormTypeEnum.appSelector
    case FormTypeEnum.boolean:
      return FormTypeEnum.boolean
    case FormTypeEnum.checkbox:
      return FormTypeEnum.checkbox
    case FormTypeEnum.dynamicSelect:
      return FormTypeEnum.dynamicSelect
    case FormTypeEnum.file:
      return FormTypeEnum.file
    case FormTypeEnum.files:
      return FormTypeEnum.files
    case FormTypeEnum.modelSelector:
      return FormTypeEnum.modelSelector
    case FormTypeEnum.multiToolSelector:
      return FormTypeEnum.multiToolSelector
    case FormTypeEnum.radio:
      return FormTypeEnum.radio
    case FormTypeEnum.secretInput:
      return FormTypeEnum.secretInput
    case FormTypeEnum.select:
      return FormTypeEnum.select
    case FormTypeEnum.textNumber:
    case 'number':
      return FormTypeEnum.textNumber
    case FormTypeEnum.textInput:
    case 'string':
    case 'array':
    case 'object':
      return FormTypeEnum.textInput
  }
  return FormTypeEnum.textInput
}

const normalizeParameterOption = (
  option: Record<string, unknown>,
): NonNullable<PluginDeclaration['trigger']['subscription_schema'][number]['options']>[number] => ({
  value: getString(option.value),
  label: normalizeI18nObject(getRecord(option, 'label'), getString(option.value)),
  icon: getString(option.icon) || undefined,
})

const normalizeParameterSchema = (
  parameter: Record<string, unknown>,
): PluginDeclaration['trigger']['subscription_schema'][number] => ({
  name: getString(parameter.name),
  label: normalizeI18nObject(getRecord(parameter, 'label'), getString(parameter.name)),
  type: normalizeFormType(parameter.type),
  auto_generate: parameter.auto_generate ?? undefined,
  template: parameter.template ?? undefined,
  scope: parameter.scope ?? undefined,
  required: getBoolean(parameter.required),
  multiple: getBoolean(parameter.multiple),
  default: normalizeParameterDefault(parameter.default),
  min: parameter.min ?? undefined,
  max: parameter.max ?? undefined,
  precision: parameter.precision ?? undefined,
  options: getRecordArray(parameter, 'options').map(normalizeParameterOption),
  description: normalizeI18nObject(getRecord(parameter, 'description')),
})

const normalizeCredentialSchema = (
  schema: Record<string, unknown>,
): PluginDeclaration['trigger']['subscription_constructor']['credentials_schema'][number] => ({
  name: getString(schema.name),
  label: normalizeI18nObject(getRecord(schema, 'label'), getString(schema.name)),
  description: normalizeI18nObject(getRecord(schema, 'description')),
  type: normalizeFormType(schema.type),
  scope: schema.scope ?? undefined,
  required: getBoolean(schema.required),
  default: schema.default ?? undefined,
  options: getRecordArray(schema, 'options').map(normalizeParameterOption),
  help: normalizeI18nObject(getRecord(schema, 'help')),
  url: getString(schema.url),
  placeholder: normalizeI18nObject(getRecord(schema, 'placeholder')),
})

const normalizeTriggerEventParameter = (
  parameter: Record<string, unknown>,
): PluginDeclaration['trigger']['events'][number]['parameters'][number] => ({
  name: getString(parameter.name),
  label: normalizeI18nObject(getRecord(parameter, 'label'), getString(parameter.name)),
  type: getString(parameter.type),
  auto_generate: parameter.auto_generate ?? undefined,
  template: parameter.template ?? undefined,
  scope: parameter.scope ?? undefined,
  required: getBoolean(parameter.required),
  multiple: getBoolean(parameter.multiple),
  default: parameter.default ?? '',
  min: getNumber(parameter.min),
  max: getNumber(parameter.max),
  precision: getNumber(parameter.precision),
  options: getRecordArray(parameter, 'options').map(normalizeParameterOption),
  description: normalizeI18nObject(getRecord(parameter, 'description')),
})

const normalizeTriggerEvent = (
  event: Record<string, unknown>,
): PluginDeclaration['trigger']['events'][number] => {
  const identity = getRecord(event, 'identity')
  const name = getString(event.name)

  return {
    name,
    identity: {
      author: getString(identity?.author),
      name: getString(identity?.name) || name,
      label: normalizeI18nObject(getRecord(identity, 'label'), name),
      provider: getString(identity?.provider) || undefined,
    },
    description: normalizeI18nObject(getRecord(event, 'description'), name),
    parameters: getRecordArray(event, 'parameters').map(normalizeTriggerEventParameter),
    output_schema: getRecord(event, 'output_schema') ?? {},
  }
}

const createEmptyTrigger = (name: string): PluginDeclaration['trigger'] => ({
  events: [],
  identity: {
    author: '',
    name,
    label: normalizeI18nObject(undefined, name),
    description: normalizeI18nObject(undefined),
    icon: '',
    tags: [],
  },
  subscription_constructor: {
    credentials_schema: [],
    oauth_schema: {
      client_schema: [],
      credentials_schema: [],
    },
    parameters: [],
  },
  subscription_schema: [],
})

const normalizePluginTriggerDeclaration = (
  value: unknown,
  fallbackName: string,
): PluginDeclaration['trigger'] => {
  if (!isRecord(value)) return createEmptyTrigger(fallbackName)

  const identity = getRecord(value, 'identity')
  const subscriptionConstructor = getRecord(value, 'subscription_constructor')
  const oauthSchema = getRecord(subscriptionConstructor, 'oauth_schema')

  return {
    events: getRecordArray(value, 'events').map(normalizeTriggerEvent),
    identity: {
      author: getString(identity?.author),
      name: getString(identity?.name) || fallbackName,
      label: normalizeI18nObject(getRecord(identity, 'label'), fallbackName),
      description: normalizeI18nObject(getRecord(identity, 'description')),
      icon: getString(identity?.icon),
      tags: getStringArray(identity?.tags),
    },
    subscription_constructor: {
      credentials_schema: getRecordArray(subscriptionConstructor, 'credentials_schema').map(
        normalizeCredentialSchema,
      ),
      oauth_schema: {
        client_schema: getRecordArray(oauthSchema, 'client_schema').map(normalizeCredentialSchema),
        credentials_schema: getRecordArray(oauthSchema, 'credentials_schema').map(
          normalizeCredentialSchema,
        ),
      },
      parameters: getRecordArray(subscriptionConstructor, 'parameters').map(
        normalizeParameterSchema,
      ),
    },
    subscription_schema: getRecordArray(value, 'subscription_schema').map(normalizeParameterSchema),
  }
}

type InstalledPluginResponse =
  | PluginCategoryInstalledPluginResponse
  | PluginEntity
  | PluginInstallationItemResponse

const normalizePluginDeclaration = (plugin: InstalledPluginResponse): PluginDeclaration => {
  const { declaration } = plugin
  return {
    plugin_unique_identifier: plugin.plugin_unique_identifier,
    version: declaration.version,
    author: declaration.author ?? '',
    icon: declaration.icon,
    icon_dark: declaration.icon_dark ?? undefined,
    name: declaration.name,
    category: normalizePluginCategory(declaration.category),
    label: normalizeI18nObject(declaration.label, declaration.name),
    description: normalizeI18nObject(declaration.description, declaration.name),
    created_at: declaration.created_at,
    resource: declaration.resource,
    plugins: declaration.plugins,
    verified: declaration.verified ?? false,
    endpoint: isRecord(declaration.endpoint)
      ? zEndpointProviderDeclarationResponse.parse(declaration.endpoint)
      : undefined,
    tool: normalizePluginToolDeclaration(declaration.tool),
    datasource:
      declaration.datasource == null
        ? declaration.datasource
        : zDatasourceProviderEntity.parse(declaration.datasource),
    model: declaration.model,
    tags: declaration.tags ?? [],
    agent_strategy:
      declaration.agent_strategy == null
        ? declaration.agent_strategy
        : zAgentStrategyProviderEntity.parse(declaration.agent_strategy),
    meta: {
      version: getString(declaration.meta.version) || declaration.version,
      minimum_dify_version: getString(declaration.meta.minimum_dify_version) || undefined,
    },
    trigger: normalizePluginTriggerDeclaration(declaration.trigger, declaration.name),
  }
}

export const normalizeInstalledPluginDetail = (plugin: InstalledPluginResponse): PluginDetail => {
  const declaration = normalizePluginDeclaration(plugin)

  return {
    id: plugin.id,
    created_at: plugin.created_at,
    updated_at: plugin.updated_at,
    name: declaration.name,
    plugin_id: plugin.plugin_id,
    plugin_unique_identifier: plugin.plugin_unique_identifier,
    declaration,
    installation_id: plugin.id,
    tenant_id: plugin.tenant_id,
    endpoints_setups: plugin.endpoints_setups,
    endpoints_active: plugin.endpoints_active,
    version: plugin.version,
    latest_version: plugin.version,
    latest_unique_identifier: plugin.plugin_unique_identifier,
    source: normalizePluginSource(plugin.source),
    meta: normalizePluginMeta(plugin.meta),
    status: 'active',
    deprecated_reason: '',
    alternative_plugin_id: '',
  }
}

type UseInstalledPluginListOptions = {
  category?: PluginCategoryEnum
  enabled?: boolean
  filters?: InstalledPluginListFilters
  gcTime?: number
  pageSize?: number
  staleTime?: number
}

type PluginCategoryListLanguage = NonNullable<
  NonNullable<GetWorkspacesCurrentPluginByCategoryListData['query']>['language']
>

type InstalledPluginListFilters = {
  language?: PluginCategoryListLanguage
  query?: string
  tags?: string[]
}

export const normalizePluginCategoryListLanguage = (locale: string): PluginCategoryListLanguage => {
  switch (locale) {
    case 'zh_Hans':
    case 'ja_JP':
    case 'pt_BR':
    case 'en_US':
      return locale
    default:
      return 'en_US'
  }
}

const getInstalledPluginCategoryListInfiniteOptions = ({
  category,
  filters,
  pageSize,
}: {
  category: PluginCategoryEnum
  filters?: InstalledPluginListFilters
  pageSize: number
}) => {
  return consoleQuery.workspaces.current.plugin.byCategory.list.get.infiniteOptions({
    input: (pageParam) => ({
      params: { category },
      query: {
        page: Number(pageParam),
        page_size: pageSize,
        ...(filters?.query ? { query: filters.query } : {}),
        ...(filters?.tags?.length ? { tags: filters.tags } : {}),
        ...(filters?.language ? { language: filters.language } : {}),
      },
    }),
    getNextPageParam: (lastPage, pages) => (lastPage.has_more ? pages.length + 1 : undefined),
    initialPageParam: 1,
  })
}

const getInstalledPluginCategoryListQueryKey = (
  category: PluginCategoryEnum,
  pageSize: number,
  filters?: InstalledPluginListFilters,
) => {
  return getInstalledPluginCategoryListInfiniteOptions({
    category,
    filters,
    pageSize,
  }).queryKey
}

export const useInstalledPluginList = (options: UseInstalledPluginListOptions = {}) => {
  const { category, enabled = true, filters, gcTime, pageSize = 100, staleTime } = options
  const categoryQuery = useInfiniteQuery({
    ...getInstalledPluginCategoryListInfiniteOptions({
      category: category ?? PluginCategoryEnum.tool,
      filters,
      pageSize,
    }),
    enabled: enabled && !!category,
    gcTime,
    staleTime,
  })
  const legacyQuery = useInfiniteQuery({
    ...consoleQuery.workspaces.current.plugin.list.get.infiniteOptions({
      input: (pageParam) => ({
        query: {
          page: Number(pageParam),
          page_size: pageSize,
        },
      }),
      getNextPageParam: (lastPage, pages) =>
        pages.length * pageSize < lastPage.total ? pages.length + 1 : undefined,
      initialPageParam: 1,
    }),
    enabled: enabled && !category,
    gcTime,
    staleTime,
  })
  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isSuccess } =
    category ? categoryQuery : legacyQuery

  const categoryData = category
    ? (data as InfiniteData<PluginCategoryListResponse, number> | undefined)
    : undefined
  const legacyData = category
    ? undefined
    : (data as InfiniteData<PluginListResponse, number> | undefined)
  const plugins: PluginDetail[] = categoryData
    ? categoryData.pages.flatMap((page) => page.plugins.map(normalizeInstalledPluginDetail))
    : (legacyData?.pages.flatMap((page) => page.plugins.map(normalizeInstalledPluginDetail)) ?? [])
  // The Built-in Tools panel still consumes its legacy Collection model. Keep the
  // API-contract boundary narrow until that presentation model is migrated.
  const builtinTools = categoryData?.pages[0]?.builtin_tools as Collection[] | undefined
  const total = legacyData?.pages[0]?.total ?? plugins.length

  return {
    data: enabled
      ? {
          plugins,
          builtin_tools: builtinTools ?? [],
          total,
        }
      : undefined,
    isLastPage: !hasNextPage,
    loadNextPage: () => {
      fetchNextPage()
    },
    isLoading,
    isFetching: isFetchingNextPage,
    error,
    isSuccess,
  }
}

export const useRemoveFilteredInstalledPluginPageOnUnmount = (
  category: PluginCategoryEnum | undefined,
  pageSize: number,
  filters?: InstalledPluginListFilters,
) => {
  const queryClient = useQueryClient()
  const hasActiveFilters = !!filters?.query || !!filters?.tags?.length

  useEffect(() => {
    if (!category || !hasActiveFilters) return

    const queryKey = getInstalledPluginCategoryListQueryKey(category, pageSize, filters)

    return () => queryClient.removeQueries({ queryKey, exact: true })
  }, [category, filters, hasActiveFilters, pageSize, queryClient])
}

export const useInvalidateInstalledPluginList = () => {
  const queryClient = useQueryClient()
  return useCallback(
    (category?: PluginCategoryEnum) => {
      // Plugin installs and updates can change a provider's actions and their parameter schemas.
      const invalidateAllBuiltInTools = () =>
        Promise.all([
          queryClient.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.tools.builtin.get.queryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey:
              consoleQuery.workspaces.current.toolProvider.builtin.byProvider.tools.get.key(),
          }),
        ])
      if (category) {
        const invalidateCategoryPluginList = queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.byCategory.list.get.key({
            type: 'infinite',
            input: { params: { category } },
          }),
        })
        const invalidateCategoryInstalledIds = queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.installedIds.get.key({
            type: 'query',
            input: { query: { category } },
          }),
        })

        if (category === PluginCategoryEnum.tool)
          return Promise.all([
            invalidateCategoryPluginList,
            invalidateCategoryInstalledIds,
            invalidateAllBuiltInTools(),
          ]).then(() => undefined)

        return Promise.all([invalidateCategoryPluginList, invalidateCategoryInstalledIds]).then(
          () => undefined,
        )
      }

      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.list.get.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.byCategory.list.get.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.installedIds.get.key(),
        }),
        invalidateAllBuiltInTools(),
      ]).then(() => undefined)
    },
    [queryClient],
  )
}

export const useInstallOrUpdate = ({
  onSuccess,
}: {
  onSuccess?: (res: InstallStatusResponse[]) => void
}) => {
  const { mutateAsync: installFromGitHub } = useMutation(
    consoleQuery.workspaces.current.plugin.install.github.post.mutationOptions(),
  )
  const { mutateAsync: installFromMarketplace } = useMutation(
    consoleQuery.workspaces.current.plugin.install.marketplace.post.mutationOptions(),
  )
  const { mutateAsync: installFromPackage } = useMutation(
    consoleQuery.workspaces.current.plugin.install.pkg.post.mutationOptions(),
  )
  const { mutateAsync: upgradeFromMarketplace } = useMutation(
    consoleQuery.workspaces.current.plugin.upgrade.marketplace.post.mutationOptions(),
  )

  return useMutation({
    mutationFn: (data: {
      payload: Dependency[]
      plugin: Plugin[]
      installedInfo: Record<string, VersionInfo>
    }) => {
      const { payload, plugin, installedInfo } = data

      return Promise.all(
        payload.map(async (item, i) => {
          try {
            const orgAndName = `${plugin[i]?.org || plugin[i]?.author}/${plugin[i]?.name}`
            const installedPayload = installedInfo[orgAndName]
            const isInstalled = !!installedPayload
            let uniqueIdentifier = ''
            let taskId = ''
            let isFinishedInstallation = false

            if (item.type === 'github') {
              const data = item as GitHubItemAndMarketPlaceDependency
              // From local bundle don't have data.value.github_plugin_unique_identifier
              uniqueIdentifier = data.value.github_plugin_unique_identifier!
              if (!uniqueIdentifier) {
                const { unique_identifier } =
                  await consoleClient.workspaces.current.plugin.upload.github.post({
                    body: {
                      repo: data.value.repo!,
                      version: data.value.release! || data.value.version!,
                      package: data.value.packages! || data.value.package!,
                    },
                  })
                uniqueIdentifier = data.value.github_plugin_unique_identifier! || unique_identifier
                // has the same version, but not installed
                if (uniqueIdentifier === installedPayload?.uniqueIdentifier) {
                  return {
                    status: TaskStatus.success,
                    taskId: '',
                    uniqueIdentifier: '',
                  }
                }
              }
              if (!isInstalled) {
                const response = await installFromGitHub({
                  body: {
                    repo: data.value.repo!,
                    version: data.value.release! || data.value.version!,
                    package: data.value.packages! || data.value.package!,
                    plugin_unique_identifier: uniqueIdentifier,
                  },
                })
                const { task_id, all_installed } = response
                taskId = task_id
                isFinishedInstallation = all_installed
              }
            }
            if (item.type === 'marketplace') {
              const data = item as GitHubItemAndMarketPlaceDependency
              uniqueIdentifier =
                data.value.marketplace_plugin_unique_identifier! ||
                (plugin[i]?.latest_package_identifier ?? '') ||
                (plugin[i]?.plugin_id ?? '')
              if (uniqueIdentifier === installedPayload?.uniqueIdentifier) {
                return {
                  status: TaskStatus.success,
                  taskId: '',
                  uniqueIdentifier: '',
                }
              }
              if (!isInstalled) {
                const response = await installFromMarketplace({
                  body: {
                    plugin_unique_identifiers: [uniqueIdentifier],
                  },
                })
                const { task_id, all_installed } = response
                taskId = task_id
                isFinishedInstallation = all_installed
              }
            }
            if (item.type === 'package') {
              const data = item as PackageDependency
              uniqueIdentifier = data.value.unique_identifier
              if (uniqueIdentifier === installedPayload?.uniqueIdentifier) {
                return {
                  status: TaskStatus.success,
                  taskId: '',
                  uniqueIdentifier: '',
                }
              }
              if (!isInstalled) {
                const response = await installFromPackage({
                  body: {
                    plugin_unique_identifiers: [uniqueIdentifier],
                  },
                })
                const { task_id, all_installed } = response
                taskId = task_id
                isFinishedInstallation = all_installed
              }
            }
            if (isInstalled) {
              if (item.type === 'package') {
                await uninstallPlugin(installedPayload.installedId, { preserveCredentials: true })
                const response = await installFromPackage({
                  body: {
                    plugin_unique_identifiers: [uniqueIdentifier],
                  },
                })
                const { task_id, all_installed } = response
                taskId = task_id
                isFinishedInstallation = all_installed
              } else {
                const response = await upgradeFromMarketplace({
                  body: {
                    original_plugin_unique_identifier: installedPayload?.uniqueIdentifier,
                    new_plugin_unique_identifier: uniqueIdentifier,
                  },
                })
                const { task_id, all_installed } = response
                taskId = task_id
                isFinishedInstallation = all_installed
              }
            }
            if (isFinishedInstallation) {
              return {
                status: TaskStatus.success,
                taskId: '',
                uniqueIdentifier: '',
              }
            } else {
              return {
                status: TaskStatus.running,
                taskId,
                uniqueIdentifier,
              }
            }
          } catch {
            return Promise.resolve({ status: TaskStatus.failed, taskId: '', uniqueIdentifier: '' })
          }
        }),
      )
    },
    onSuccess,
  })
}

const pluginPermissionSettingsQueryKey = () =>
  consoleQuery.workspaces.current.plugin.permission.fetch.get.queryKey()
const pluginAutoUpgradeSettingsQueryKey = (category: PluginCategoryEnum) =>
  consoleQuery.workspaces.current.plugin.autoUpgrade.fetch.get.queryKey({
    input: { query: { category } },
  })

const areStringArraysEqual = (left: string[], right: string[]) => {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

const arePermissionsEqual = (left: Permissions | undefined, right: Permissions | undefined) => {
  return (
    left?.install_permission === right?.install_permission &&
    left?.debug_permission === right?.debug_permission
  )
}

const areAutoUpgradeSettingsEqual = (
  left: AutoUpdateConfig | undefined,
  right: AutoUpdateConfig | undefined,
) => {
  return (
    left?.strategy_setting === right?.strategy_setting &&
    left?.upgrade_time_of_day === right?.upgrade_time_of_day &&
    left?.upgrade_mode === right?.upgrade_mode &&
    areStringArraysEqual(left?.exclude_plugins ?? [], right?.exclude_plugins ?? []) &&
    areStringArraysEqual(left?.include_plugins ?? [], right?.include_plugins ?? [])
  )
}

// legacy plugin permission
// export const hasPluginPermission = (permission: PermissionType | undefined, isAdmin: boolean) => {
//   if (!permission)
//     return false

//   if (permission === PermissionType.noOne)
//     return false

//   if (permission === PermissionType.everyone)
//     return true

//   return isAdmin
// }

// Settings saves are not optimistic: the setting keeps its saved value while a save is
// pending, shows the accepted value once the server confirms it, and is read again afterwards
// (the invalidation fallback waits until no plugin write is pending).
async function writeSavedSetting(queryClient: QueryClient, queryKey: QueryKey, value: unknown) {
  if (queryClient.isFetching({ queryKey })) await queryClient.cancelQueries({ queryKey })
  queryClient.setQueryData(queryKey, value)
}

const permissionChangeKey = () =>
  consoleQuery.workspaces.current.plugin.permission.change.post.mutationKey()
// Categories are separate settings, so each has its own pending count.
const autoUpgradeChangeKey = (category: PluginCategoryEnum) => [
  ...consoleQuery.workspaces.current.plugin.autoUpgrade.change.post.mutationKey(),
  category,
]

export const useMutationPluginPermissionSettings = ({
  onSuccess,
}: {
  onSuccess?: () => void
} = {}) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: permissionChangeKey(),
    mutationFn: (payload: Permissions) => {
      return consoleClient.workspaces.current.plugin.permission.change.post({ body: payload })
    },
    onSuccess: async (_data, payload) => {
      await writeSavedSetting(queryClient, pluginPermissionSettingsQueryKey(), payload)
      onSuccess?.()
    },
  })
}

export const useMutationPluginAutoUpgradeSettings = ({
  category,
  onSuccess,
}: {
  category: PluginCategoryEnum
  onSuccess?: () => void
}) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: autoUpgradeChangeKey(category),
    mutationFn: (payload: AutoUpdateConfig) => {
      return consoleClient.workspaces.current.plugin.autoUpgrade.change.post({
        body: {
          category,
          auto_upgrade: payload,
        },
      })
    },
    // The category this save started for; the caller may have moved to another one since.
    onMutate: () => ({ category }),
    onSuccess: async (_data, payload, { category: savedCategory }) => {
      await writeSavedSetting(queryClient, pluginAutoUpgradeSettingsQueryKey(savedCategory), {
        category: savedCategory,
        auto_upgrade: payload,
      })
      onSuccess?.()
    },
  })
}

export const useMutationReferenceSettings = ({
  category,
  currentReferenceSetting,
  onSuccess,
}: {
  category: PluginCategoryEnum
  currentReferenceSetting?: ReferenceSetting
  onSuccess?: () => void
}) => {
  const permission = useMutationPluginPermissionSettings()
  const autoUpgrade = useMutationPluginAutoUpgradeSettings({ category })

  const mutate = (payload: ReferenceSetting) => {
    const saves: Array<Promise<unknown>> = []
    if (!arePermissionsEqual(payload.permission, currentReferenceSetting?.permission))
      saves.push(permission.mutateAsync(payload.permission))
    if (!areAutoUpgradeSettingsEqual(payload.auto_upgrade, currentReferenceSetting?.auto_upgrade))
      saves.push(autoUpgrade.mutateAsync(payload.auto_upgrade))
    // Failures are reported by the mutation cache.
    Promise.all(saves).then(
      () => onSuccess?.(),
      () => {},
    )
  }

  return { mutate, isPending: permission.isPending || autoUpgrade.isPending }
}

export const usePluginTaskList = (category?: PluginCategoryEnum | string) => {
  const initializedRef = useRef(false)
  const queryClient = useQueryClient()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManagement = hasPermission(workspacePermissionKeys, 'plugin.install')
  const { refreshPluginList } = useRefreshPluginList()
  const query = useQuery(pluginTaskListQueryOptions({ enabled: canManagement }))
  const { data, isFetched, isRefetching } = query

  useEffect(() => {
    // After first fetch, refresh plugin list each time all tasks are done
    // Skip initialization period, because the query cache is not updated yet
    if (!initializedRef.current) {
      initializedRef.current = true
      return
    }

    if (isRefetching) return

    const lastData = cloneDeep(data)
    const taskDone = lastData?.tasks.every(
      (task) => task.status === TaskStatus.success || task.status === TaskStatus.failed,
    )
    const taskAllFailed = lastData?.tasks.every((task) => task.status === TaskStatus.failed)
    if (taskDone && lastData?.tasks.length && !taskAllFailed)
      refreshPluginList(
        category ? { category: category as PluginCategoryEnum } : undefined,
        !category,
      )
  }, [category, data, isRefetching, refreshPluginList])

  const invalidatePluginTasks = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.plugin.tasks.get.queryKey({
          input: pluginTaskListInput,
        }),
      }),
    [queryClient],
  )

  const handleInstallTaskStart = useCallback(
    (response: PluginInstallTaskStartResponse) => {
      if (response.all_installed) return

      upsertStartedPluginTask(consoleQuery, queryClient, response)
      void invalidatePluginTasks()
    },
    [invalidatePluginTasks, queryClient],
  )

  return {
    data,
    pluginTasks: data?.tasks || [],
    isFetched,
    invalidatePluginTasks,
    handleInstallTaskStart,
  }
}
