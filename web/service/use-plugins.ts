import type { PluginInstallationItemResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  PluginInfoFromMarketPlace,
  PluginsFromMarketplaceByInfoResponse,
  PluginsFromMarketplaceResponse,
} from '@dify/contracts/marketplace'
import type { MutateOptions, QueryClient, QueryOptions } from '@tanstack/react-query'
import type {
  FormOption,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { AutoUpdateConfig } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import type {
  DebugInfo as DebugInfoTypes,
  Dependency,
  GitHubItemAndMarketPlaceDependency,
  InstalledPluginCategoryListResponse,
  InstalledPluginListWithTotalResponse,
  InstallPackageResponse,
  InstallStatusResponse,
  MetaData,
  PackageDependency,
  Permissions,
  Plugin,
  PluginDeclaration,
  PluginDetail,
  PluginTask,
  PluginTaskStart,
  ReferenceSetting,
  uploadGitHubResponse,
  VersionInfo,
  VersionListResponse,
} from '@/app/components/plugins/types'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cloneDeep } from 'es-toolkit/object'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef } from 'react'
import { FormTypeEnum } from '@/app/components/base/form/types'
import useRefreshPluginList from '@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list'
import { getFormattedPlugin } from '@/app/components/plugins/marketplace/utils'
import { PluginCategoryEnum, PluginSource, TaskStatus } from '@/app/components/plugins/types'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { fetchModelProviderModelList } from '@/service/common'
import { fetchPluginInfoFromMarketPlace, uninstallPlugin } from '@/service/plugins'
import { hasPermission } from '@/utils/permission'
// eslint-disable-next-line no-restricted-imports
import { get, getMarketplace, post, postMarketplace } from './base'
import { consoleQuery } from './client'
import { useInvalidateAllBuiltInTools } from './use-tools'

const NAME_SPACE = 'plugins'
const useInstalledPluginListKey = [NAME_SPACE, 'installedPluginList']
const usePluginTaskListKey = [NAME_SPACE, 'pluginTaskList']

type PluginTaskListResponse = {
  tasks: PluginTask[]
}

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
    en_US: en,
    zh_Hans: zhHans,
    ja_JP: ja,
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

const normalizePluginEndpointDeclaration = (value: unknown): PluginDeclaration['endpoint'] => {
  if (!isRecord(value)) return undefined

  return {
    settings: getRecordArray(value, 'settings').map(normalizeToolCredential),
    endpoints: getRecordArray(value, 'endpoints').map((endpoint) => ({
      path: getString(endpoint.path),
      method: getString(endpoint.method),
      hidden: endpoint.hidden === undefined ? undefined : getBoolean(endpoint.hidden),
    })),
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

const normalizePluginDeclaration = (plugin: PluginInstallationItemResponse): PluginDeclaration => {
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
    endpoint: normalizePluginEndpointDeclaration(declaration.endpoint),
    tool: normalizePluginToolDeclaration(declaration.tool),
    datasource: normalizePluginToolDeclaration(declaration.datasource),
    model: declaration.model,
    tags: declaration.tags ?? [],
    agent_strategy: declaration.agent_strategy,
    meta: {
      version: getString(declaration.meta.version) || declaration.version,
      minimum_dify_version: getString(declaration.meta.minimum_dify_version) || undefined,
    },
    trigger: normalizePluginTriggerDeclaration(declaration.trigger, declaration.name),
  }
}

export const normalizeInstalledPluginDetail = (
  plugin: PluginInstallationItemResponse,
): PluginDetail => {
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

const isUnfinishedPluginTask = (task: PluginTask) =>
  task.status === TaskStatus.pending || task.status === TaskStatus.running

const normalizeStartedPluginTask = (task: PluginTaskStart): PluginTask => ({
  ...task,
  plugins: task.plugins.map((plugin) => ({
    ...plugin,
    taskId: plugin.taskId || task.id,
  })),
})

const upsertStartedPluginTask = (queryClient: QueryClient, response: InstallPackageResponse) => {
  if (!response.task) return

  const startedTask = normalizeStartedPluginTask(response.task)

  queryClient.setQueryData<PluginTaskListResponse>(usePluginTaskListKey, (previous) => {
    if (!previous) return { tasks: [startedTask] }

    const existingTaskIndex = previous.tasks.findIndex((task) => task.id === startedTask.id)
    if (existingTaskIndex === -1) return { tasks: [startedTask, ...previous.tasks] }

    return {
      tasks: previous.tasks.map((task) => (task.id === startedTask.id ? startedTask : task)),
    }
  })
}

const preserveLocalUnfinishedPluginTasks = (
  previousData: PluginTaskListResponse | undefined,
  nextData: PluginTaskListResponse,
) => {
  if (!previousData) return nextData

  const nextTaskIds = new Set(nextData.tasks.map((task) => task.id))
  const missingUnfinishedTasks = previousData.tasks.filter(
    (task) => !nextTaskIds.has(task.id) && isUnfinishedPluginTask(task),
  )
  if (!missingUnfinishedTasks.length) return nextData

  return {
    ...nextData,
    tasks: [...missingUnfinishedTasks, ...nextData.tasks],
  }
}

export const useCheckInstalled = ({
  pluginIds,
  enabled,
}: {
  pluginIds: string[]
  enabled: boolean
}) => {
  return useQuery(
    consoleQuery.workspaces.current.plugin.list.installations.ids.post.queryOptions({
      input: { body: { plugin_ids: pluginIds } },
      enabled,
      staleTime: 0,
      select: (response) => ({
        plugins: response.plugins.map(normalizeInstalledPluginDetail),
      }),
    }),
  )
}

export const useInvalidateCheckInstalled = () => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: consoleQuery.workspaces.current.plugin.list.installations.ids.post.key(),
    })
  }
}

const useRecommendedMarketplacePluginsKey = [NAME_SPACE, 'recommendedMarketplacePlugins']
const useRecommendedMarketplacePlugins = ({
  collection = '__recommended-plugins-tools',
  enabled = true,
  limit = 15,
}: {
  collection?: string
  enabled?: boolean
  limit?: number
} = {}) => {
  return useQuery<Plugin[]>({
    queryKey: [...useRecommendedMarketplacePluginsKey, collection, limit],
    queryFn: async () => {
      const response = await postMarketplace<{ data: { plugins: Plugin[] } }>(
        `/collections/${collection}/plugins`,
        {
          body: {
            limit,
          },
        },
      )
      return response.data.plugins.map((plugin) => getFormattedPlugin(plugin))
    },
    enabled,
    staleTime: 60 * 1000,
  })
}

export const useFeaturedToolsRecommendations = (enabled: boolean, limit = 15) => {
  const { data: plugins = [], isLoading } = useRecommendedMarketplacePlugins({
    collection: '__recommended-plugins-tools',
    enabled,
    limit,
  })

  return {
    plugins,
    isLoading,
  }
}

export const useFeaturedTriggersRecommendations = (enabled: boolean, limit = 15) => {
  const { data: plugins = [], isLoading } = useRecommendedMarketplacePlugins({
    collection: '__recommended-plugins-triggers',
    enabled,
    limit,
  })

  return {
    plugins,
    isLoading,
  }
}

type UseInstalledPluginListOptions = {
  category?: PluginCategoryEnum
  refetchOnMount?: boolean | 'always'
}

export const useInstalledPluginList = (
  disable?: boolean,
  pageSize = 100,
  options?: UseInstalledPluginListOptions,
) => {
  const category = options?.category
  const fetchPlugins = async ({ pageParam = 1 }) => {
    const path = category
      ? `/workspaces/current/plugin/${category}/list`
      : '/workspaces/current/plugin/list'

    if (category)
      return get<InstalledPluginCategoryListResponse>(
        `${path}?page=${pageParam}&page_size=${pageSize}`,
      )

    return get<InstalledPluginListWithTotalResponse>(
      `${path}?page=${pageParam}&page_size=${pageSize}`,
    )
  }

  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isSuccess } =
    useInfiniteQuery({
      enabled: !disable,
      queryKey: category ? [...useInstalledPluginListKey, category] : useInstalledPluginListKey,
      queryFn: fetchPlugins,
      getNextPageParam: (lastPage, pages) => {
        if (category)
          return 'has_more' in lastPage && lastPage.has_more ? pages.length + 1 : undefined

        const totalItems = 'total' in lastPage ? lastPage.total : 0
        const currentPage = pages.length
        const itemsLoaded = currentPage * pageSize

        if (itemsLoaded >= totalItems) return

        return currentPage + 1
      },
      initialPageParam: 1,
      refetchOnMount: options?.refetchOnMount,
    })

  const plugins = data?.pages.flatMap((page) => page.plugins) ?? []
  const firstPage = data?.pages[0]
  const builtinTools = firstPage && 'builtin_tools' in firstPage ? firstPage.builtin_tools : []
  const total = data?.pages[0] && 'total' in data.pages[0] ? data.pages[0].total : plugins.length

  return {
    data: disable
      ? undefined
      : {
          plugins,
          builtin_tools: builtinTools,
          total,
        },
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

export const useInvalidateInstalledPluginList = () => {
  const queryClient = useQueryClient()
  const invalidateAllBuiltInTools = useInvalidateAllBuiltInTools()
  return () => {
    queryClient.invalidateQueries({
      queryKey: useInstalledPluginListKey,
    })
    invalidateAllBuiltInTools()
  }
}

export const useInstallPackageFromMarketPlace = (
  options?: MutateOptions<InstallPackageResponse, Error, string>,
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (uniqueIdentifier: string) => {
      return post<InstallPackageResponse>('/workspaces/current/plugin/install/marketplace', {
        body: { plugin_unique_identifiers: [uniqueIdentifier] },
      })
    },
    onSuccess: (data, variables, context, mutation) => {
      upsertStartedPluginTask(queryClient, data)
      options?.onSuccess?.(data, variables, context, mutation)
    },
  })
}

export const useUpdatePackageFromMarketPlace = (
  options?: MutateOptions<InstallPackageResponse, Error, object>,
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (body: object) => {
      return post<InstallPackageResponse>('/workspaces/current/plugin/upgrade/marketplace', {
        body,
      })
    },
    onSuccess: (data, variables, context, mutation) => {
      upsertStartedPluginTask(queryClient, data)
      options?.onSuccess?.(data, variables, context, mutation)
    },
  })
}

export const usePluginDeclarationFromMarketPlace = (pluginUniqueIdentifier: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'pluginDeclaration', pluginUniqueIdentifier],
    queryFn: () =>
      get<{ manifest: PluginDeclaration }>('/workspaces/current/plugin/marketplace/pkg', {
        params: { plugin_unique_identifier: pluginUniqueIdentifier },
      }),
    enabled: !!pluginUniqueIdentifier,
  })
}

export const useVersionListOfPlugin = (pluginID: string) => {
  return useQuery<{ data: VersionListResponse }>({
    enabled: !!pluginID,
    queryKey: [NAME_SPACE, 'versions', pluginID],
    queryFn: () =>
      getMarketplace<{ data: VersionListResponse }>(`/plugins/${pluginID}/versions`, {
        params: { page: 1, page_size: 100 },
      }),
  })
}

export const useInstallPackageFromLocal = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (uniqueIdentifier: string) => {
      return post<InstallPackageResponse>('/workspaces/current/plugin/install/pkg', {
        body: { plugin_unique_identifiers: [uniqueIdentifier] },
      })
    },
    onSuccess: (data) => {
      upsertStartedPluginTask(queryClient, data)
    },
  })
}

export const useInstallPackageFromGitHub = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      repoUrl,
      selectedVersion,
      selectedPackage,
      uniqueIdentifier,
    }: {
      repoUrl: string
      selectedVersion: string
      selectedPackage: string
      uniqueIdentifier: string
    }) => {
      return post<InstallPackageResponse>('/workspaces/current/plugin/install/github', {
        body: {
          repo: repoUrl,
          version: selectedVersion,
          package: selectedPackage,
          plugin_unique_identifier: uniqueIdentifier,
        },
      })
    },
    onSuccess: (data) => {
      upsertStartedPluginTask(queryClient, data)
    },
  })
}

export const useUploadGitHub = (payload: { repo: string; version: string; package: string }) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'uploadGitHub', payload],
    queryFn: () =>
      post<uploadGitHubResponse>('/workspaces/current/plugin/upload/github', {
        body: payload,
      }),
    retry: 0,
  })
}

export const useInstallOrUpdate = ({
  onSuccess,
}: {
  onSuccess?: (res: InstallStatusResponse[]) => void
}) => {
  const queryClient = useQueryClient()
  const { mutateAsync: updatePackageFromMarketPlace } = useUpdatePackageFromMarketPlace()

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
                const { unique_identifier } = await post<uploadGitHubResponse>(
                  '/workspaces/current/plugin/upload/github',
                  {
                    body: {
                      repo: data.value.repo!,
                      version: data.value.release! || data.value.version!,
                      package: data.value.packages! || data.value.package!,
                    },
                  },
                )
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
                const response = await post<InstallPackageResponse>(
                  '/workspaces/current/plugin/install/github',
                  {
                    body: {
                      repo: data.value.repo!,
                      version: data.value.release! || data.value.version!,
                      package: data.value.packages! || data.value.package!,
                      plugin_unique_identifier: uniqueIdentifier,
                    },
                  },
                )
                upsertStartedPluginTask(queryClient, response)
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
                const response = await post<InstallPackageResponse>(
                  '/workspaces/current/plugin/install/marketplace',
                  {
                    body: {
                      plugin_unique_identifiers: [uniqueIdentifier],
                    },
                  },
                )
                upsertStartedPluginTask(queryClient, response)
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
                const response = await post<InstallPackageResponse>(
                  '/workspaces/current/plugin/install/pkg',
                  {
                    body: {
                      plugin_unique_identifiers: [uniqueIdentifier],
                    },
                  },
                )
                upsertStartedPluginTask(queryClient, response)
                const { task_id, all_installed } = response
                taskId = task_id
                isFinishedInstallation = all_installed
              }
            }
            if (isInstalled) {
              if (item.type === 'package') {
                await uninstallPlugin(installedPayload.installedId)
                const response = await post<InstallPackageResponse>(
                  '/workspaces/current/plugin/install/pkg',
                  {
                    body: {
                      plugin_unique_identifiers: [uniqueIdentifier],
                    },
                  },
                )
                upsertStartedPluginTask(queryClient, response)
                const { task_id, all_installed } = response
                taskId = task_id
                isFinishedInstallation = all_installed
              } else {
                const response = await updatePackageFromMarketPlace({
                  original_plugin_unique_identifier: installedPayload?.uniqueIdentifier,
                  new_plugin_unique_identifier: uniqueIdentifier,
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

export const useDebugKey = () => {
  return useQuery({
    queryKey: [NAME_SPACE, 'debugKey'],
    queryFn: () => get<DebugInfoTypes>('/workspaces/current/plugin/debugging-key'),
  })
}

type PluginAutoUpgradeSettingsResponse = {
  category: PluginCategoryEnum
  auto_upgrade: AutoUpdateConfig
}

type MarketplacePluginInfoRequest = {
  organization?: string
  plugin?: string
  version?: string
}

const useReferenceSettingKey = [NAME_SPACE, 'referenceSettings']
const usePluginPermissionSettingsKey = [...useReferenceSettingKey, 'permission']
const usePluginAutoUpgradeSettingsKey = [...useReferenceSettingKey, 'autoUpgrade']
const pluginAutoUpgradeSettingsQueryKey = (category: PluginCategoryEnum) => [
  ...usePluginAutoUpgradeSettingsKey,
  category,
]

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

export const usePluginPermissionSettings = () => {
  return useQuery({
    queryKey: usePluginPermissionSettingsKey,
    queryFn: () => get<Permissions>('/workspaces/current/plugin/permission/fetch'),
  })
}

export const usePluginAutoUpgradeSettings = (category: PluginCategoryEnum) => {
  return useQuery({
    queryKey: pluginAutoUpgradeSettingsQueryKey(category),
    queryFn: () =>
      get<PluginAutoUpgradeSettingsResponse>('/workspaces/current/plugin/auto-upgrade/fetch', {
        params: { category },
      }),
    staleTime: 60 * 1000,
  })
}

export const useInvalidateReferenceSettings = () => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: useReferenceSettingKey,
    })
  }
}

export const useMutationPluginPermissionSettings = ({
  onSuccess,
}: {
  onSuccess?: () => void
} = {}) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: Permissions) => {
      return post('/workspaces/current/plugin/permission/change', { body: payload })
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: usePluginPermissionSettingsKey })
      const previousPermission = queryClient.getQueryData<Permissions>(
        usePluginPermissionSettingsKey,
      )
      const hadPreviousPermission = previousPermission !== undefined

      queryClient.setQueryData(usePluginPermissionSettingsKey, payload)

      return { previousPermission, hadPreviousPermission }
    },
    onError: (_error, _payload, context) => {
      if (context?.hadPreviousPermission)
        queryClient.setQueryData(usePluginPermissionSettingsKey, context.previousPermission)
      else queryClient.removeQueries({ queryKey: usePluginPermissionSettingsKey })
    },
    onSuccess: () => {
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
    mutationFn: (payload: AutoUpdateConfig) => {
      return post('/workspaces/current/plugin/auto-upgrade/change', {
        body: {
          category,
          auto_upgrade: payload,
        },
      })
    },
    onMutate: async (payload) => {
      const queryKey = pluginAutoUpgradeSettingsQueryKey(category)
      await queryClient.cancelQueries({ queryKey })
      const previousAutoUpgrade =
        queryClient.getQueryData<PluginAutoUpgradeSettingsResponse>(queryKey)
      const hadPreviousAutoUpgrade = previousAutoUpgrade !== undefined

      queryClient.setQueryData(pluginAutoUpgradeSettingsQueryKey(category), {
        category,
        auto_upgrade: payload,
      } satisfies PluginAutoUpgradeSettingsResponse)

      return { previousAutoUpgrade, hadPreviousAutoUpgrade }
    },
    onError: (_error, _payload, context) => {
      if (context?.hadPreviousAutoUpgrade)
        queryClient.setQueryData(
          pluginAutoUpgradeSettingsQueryKey(category),
          context.previousAutoUpgrade,
        )
      else queryClient.removeQueries({ queryKey: pluginAutoUpgradeSettingsQueryKey(category) })
    },
    onSuccess: () => {
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
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: ReferenceSetting) => {
      const mutations: Array<Promise<unknown>> = []

      if (!arePermissionsEqual(payload.permission, currentReferenceSetting?.permission))
        mutations.push(
          post('/workspaces/current/plugin/permission/change', { body: payload.permission }),
        )

      if (
        !areAutoUpgradeSettingsEqual(payload.auto_upgrade, currentReferenceSetting?.auto_upgrade)
      ) {
        mutations.push(
          post('/workspaces/current/plugin/auto-upgrade/change', {
            body: {
              category,
              auto_upgrade: payload.auto_upgrade,
            },
          }),
        )
      }

      return Promise.all(mutations)
    },
    onMutate: async (payload) => {
      const shouldUpdatePermission = !arePermissionsEqual(
        payload.permission,
        currentReferenceSetting?.permission,
      )
      const shouldUpdateAutoUpgrade = !areAutoUpgradeSettingsEqual(
        payload.auto_upgrade,
        currentReferenceSetting?.auto_upgrade,
      )
      const autoUpgradeQueryKey = pluginAutoUpgradeSettingsQueryKey(category)

      await Promise.all([
        shouldUpdatePermission
          ? queryClient.cancelQueries({ queryKey: usePluginPermissionSettingsKey })
          : Promise.resolve(),
        shouldUpdateAutoUpgrade
          ? queryClient.cancelQueries({ queryKey: autoUpgradeQueryKey })
          : Promise.resolve(),
      ])

      const previousPermission = queryClient.getQueryData<Permissions>(
        usePluginPermissionSettingsKey,
      )
      const previousAutoUpgrade =
        queryClient.getQueryData<PluginAutoUpgradeSettingsResponse>(autoUpgradeQueryKey)
      const hadPreviousPermission = previousPermission !== undefined
      const hadPreviousAutoUpgrade = previousAutoUpgrade !== undefined

      if (shouldUpdatePermission)
        queryClient.setQueryData(usePluginPermissionSettingsKey, payload.permission)

      if (shouldUpdateAutoUpgrade) {
        queryClient.setQueryData(autoUpgradeQueryKey, {
          category,
          auto_upgrade: payload.auto_upgrade,
        } satisfies PluginAutoUpgradeSettingsResponse)
      }

      return {
        previousPermission,
        previousAutoUpgrade,
        hadPreviousPermission,
        hadPreviousAutoUpgrade,
        shouldUpdatePermission,
        shouldUpdateAutoUpgrade,
      }
    },
    onError: (_error, _payload, context) => {
      if (context?.shouldUpdatePermission && context.hadPreviousPermission)
        queryClient.setQueryData(usePluginPermissionSettingsKey, context.previousPermission)
      else if (context?.shouldUpdatePermission)
        queryClient.removeQueries({ queryKey: usePluginPermissionSettingsKey })

      if (context?.shouldUpdateAutoUpgrade && context.hadPreviousAutoUpgrade)
        queryClient.setQueryData(
          pluginAutoUpgradeSettingsQueryKey(category),
          context.previousAutoUpgrade,
        )
      else if (context?.shouldUpdateAutoUpgrade)
        queryClient.removeQueries({ queryKey: pluginAutoUpgradeSettingsQueryKey(category) })
    },
    onSuccess,
  })
}

export const useRemoveAutoUpgrade = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: { plugin_id: string; category: PluginCategoryEnum }) => {
      return post('/workspaces/current/plugin/auto-upgrade/exclude', { body: payload })
    },
    onSuccess: (_data, payload) => {
      queryClient.invalidateQueries({
        queryKey: pluginAutoUpgradeSettingsQueryKey(payload.category),
      })
    },
  })
}

export const useFetchPluginsInMarketPlaceByIds = (
  unique_identifiers: string[],
  options?: QueryOptions<{ data: PluginsFromMarketplaceResponse }>,
) => {
  return useQuery({
    ...options,
    queryKey: [NAME_SPACE, 'fetchPluginsInMarketPlaceByIds', unique_identifiers],
    queryFn: () =>
      postMarketplace<{ data: PluginsFromMarketplaceResponse }>('/plugins/identifier/batch', {
        body: {
          unique_identifiers,
        },
      }),
    enabled: unique_identifiers?.filter((i) => !!i).length > 0,
    retry: 0,
  })
}

export const useFetchPluginsInMarketPlaceByInfo = (infos: MarketplacePluginInfoRequest[]) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'fetchPluginsInMarketPlaceByInfo', infos],
    queryFn: () =>
      postMarketplace<{ data: PluginsFromMarketplaceByInfoResponse }>('/plugins/versions/batch', {
        body: {
          plugin_tuples: infos.map((info) => ({
            org: info.organization,
            name: info.plugin,
            version: info.version,
          })),
        },
      }),
    enabled: infos?.filter((i) => !!i).length > 0,
    retry: 0,
  })
}

export const usePluginTaskList = (category?: PluginCategoryEnum | string) => {
  const initializedRef = useRef(false)
  const queryClient = useQueryClient()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManagement = hasPermission(workspacePermissionKeys, 'plugin.install')
  const { refreshPluginList } = useRefreshPluginList()
  const query = useQuery<PluginTaskListResponse>({
    enabled: canManagement,
    queryKey: usePluginTaskListKey,
    queryFn: () =>
      get<{ tasks: PluginTask[] }>('/workspaces/current/plugin/tasks?page=1&page_size=100'),
    structuralSharing: (previousData, nextData) =>
      preserveLocalUnfinishedPluginTasks(
        previousData as PluginTaskListResponse | undefined,
        nextData as PluginTaskListResponse,
      ),
    refetchInterval: (lastQuery) => {
      const lastData = lastQuery.state.data
      const taskDone = lastData?.tasks.every(
        (task) => task.status === TaskStatus.success || task.status === TaskStatus.failed,
      )
      return taskDone ? false : 5000
    },
  })
  const { data, isFetched, isRefetching, refetch } = query

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
      refreshPluginList(category ? { category } : undefined, !category)
  }, [category, data, isRefetching, refreshPluginList])

  const handleRefetch = useCallback(() => {
    refetch()
  }, [refetch])

  const handleInstallTaskStart = useCallback(
    (response: InstallPackageResponse) => {
      if (response.all_installed) return

      upsertStartedPluginTask(queryClient, response)
      refetch()
    },
    [queryClient, refetch],
  )

  return {
    data,
    pluginTasks: data?.tasks || [],
    isFetched,
    handleRefetch,
    handleInstallTaskStart,
  }
}

export const useMutationClearTaskPlugin = () => {
  return useMutation({
    mutationFn: ({ taskId, pluginId }: { taskId: string; pluginId: string }) => {
      const encodedPluginId = encodeURIComponent(pluginId)
      return post<{ success: boolean }>(
        `/workspaces/current/plugin/tasks/${taskId}/delete/${encodedPluginId}`,
      )
    },
  })
}

export const usePluginManifestInfo = (pluginUID: string) => {
  return useQuery({
    enabled: !!pluginUID,
    queryKey: [NAME_SPACE, 'manifest', pluginUID],
    queryFn: () =>
      getMarketplace<{ data: { plugin: PluginInfoFromMarketPlace; version: { version: string } } }>(
        `/plugins/${pluginUID}`,
      ),
    retry: 0,
  })
}

export const useMutationCheckDependencies = () => {
  return useMutation({
    mutationFn: (appId: string) => {
      return get<{ leaked_dependencies: Dependency[] }>(`/apps/imports/${appId}/check-dependencies`)
    },
  })
}

export const useModelInList = (currentProvider?: ModelProvider, modelId?: string) => {
  const provider = currentProvider?.provider
  return useQuery({
    queryKey: ['modelInList', provider, modelId],
    queryFn: async () => {
      if (!modelId || !provider) return false
      try {
        const modelsData = await fetchModelProviderModelList(
          `/workspaces/current/model-providers/${provider}/models`,
        )
        return !!modelId && modelsData.data.some((item) => item.model === modelId)
      } catch {
        return false
      }
    },
    enabled: !!modelId && !!provider,
  })
}

export const usePluginInfo = (providerName?: string) => {
  return useQuery({
    queryKey: ['pluginInfo', providerName],
    queryFn: async () => {
      if (!providerName) return null
      const parts = providerName.split('/')
      const org = parts[0]
      const name = parts[1]
      try {
        const response = await fetchPluginInfoFromMarketPlace({ org: org!, name: name! })
        return response.data.plugin.category === PluginCategoryEnum.model
          ? response.data.plugin
          : null
      } catch {
        return null
      }
    },
    enabled: !!providerName,
  })
}

export const useFetchDynamicOptions = (
  plugin_id: string,
  provider: string,
  action: string,
  parameter: string,
  provider_type?: string,
  extra?: Record<string, unknown>,
) => {
  return useMutation({
    mutationFn: () =>
      get<{ options: FormOption[] }>('/workspaces/current/plugin/parameters/dynamic-options', {
        params: {
          plugin_id,
          provider,
          action,
          parameter,
          provider_type,
          ...extra,
        },
      }),
  })
}

export const usePluginReadme = ({
  plugin_unique_identifier,
  language,
}: {
  plugin_unique_identifier: string
  language?: string
}) => {
  return useQuery({
    queryKey: ['pluginReadme', plugin_unique_identifier, language],
    queryFn: () =>
      get<{ readme: string }>(
        '/workspaces/current/plugin/readme',
        { params: { plugin_unique_identifier, language } },
        { silent: true },
      ),
    enabled: !!plugin_unique_identifier,
    retry: 0,
  })
}

export const usePluginReadmeAsset = ({
  file_name,
  plugin_unique_identifier,
}: {
  file_name?: string
  plugin_unique_identifier?: string
}) => {
  const normalizedFileName = file_name?.replace(/^\.\/_assets\//, '').replace(/^_assets\//, '')
  const isAssetFile = file_name?.startsWith('./_assets') || file_name?.startsWith('_assets')
  return useQuery({
    queryKey: ['pluginReadmeAsset', plugin_unique_identifier, normalizedFileName],
    queryFn: () =>
      get<Blob>(
        '/workspaces/current/plugin/asset',
        { params: { plugin_unique_identifier, file_name: normalizedFileName } },
        { silent: true },
      ),
    enabled: !!plugin_unique_identifier && !!isAssetFile,
  })
}
