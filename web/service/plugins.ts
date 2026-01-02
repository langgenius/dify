import type { FormOption } from '@/app/components/base/form/types'
import type {
  MarketplaceCollectionPluginsResponse,
  MarketplaceCollectionsResponse,
  PluginsSearchParams,
} from '@/app/components/plugins/marketplace/types'
import type {
  DebugInfo,
  Dependency,
  InstalledLatestVersionResponse,
  InstalledPluginListWithTotalResponse,
  InstallPackageResponse,
  Permissions,
  Plugin,
  PluginDeclaration,
  PluginDetail,
  PluginInfoFromMarketPlace,
  PluginManifestInMarket,
  PluginsFromMarketplaceByInfoResponse,
  PluginsFromMarketplaceResponse,
  PluginTask,
  PluginTasksResponse,
  ReferenceSetting,
  TaskStatusResponse,
  UninstallPluginResponse,
  updatePackageResponse,
  uploadGitHubResponse,
  VersionListResponse,
} from '@/app/components/plugins/types'
import { get, getMarketplace, post, postMarketplace, upload } from './base'

export const uploadFile = async (file: File, isBundle: boolean) => {
  const formData = new FormData()
  formData.append(isBundle ? 'bundle' : 'pkg', file)
  return upload({
    xhr: new XMLHttpRequest(),
    data: formData,
  }, false, `/workspaces/current/plugin/upload/${isBundle ? 'bundle' : 'pkg'}`)
}

export const updateFromMarketPlace = async (body: Record<string, string>) => {
  return post<InstallPackageResponse>('/workspaces/current/plugin/upgrade/marketplace', {
    body,
  })
}

export const updateFromGitHub = async (repoUrl: string, selectedVersion: string, selectedPackage: string, originalPlugin: string, newPlugin: string) => {
  return post<updatePackageResponse>('/workspaces/current/plugin/upgrade/github', {
    body: {
      repo: repoUrl,
      version: selectedVersion,
      package: selectedPackage,
      original_plugin_unique_identifier: originalPlugin,
      new_plugin_unique_identifier: newPlugin,
    },
  })
}

export const uploadGitHub = async (repoUrl: string, selectedVersion: string, selectedPackage: string) => {
  return post<uploadGitHubResponse>('/workspaces/current/plugin/upload/github', {
    body: {
      repo: repoUrl,
      version: selectedVersion,
      package: selectedPackage,
    },
  })
}

export const fetchIcon = (tenantId: string, fileName: string) => {
  return get(`workspaces/current/plugin/icon?tenant_id=${tenantId}&filename=${fileName}`)
}

export const fetchManifest = async (uniqueIdentifier: string) => {
  return get<PluginDeclaration>(`/workspaces/current/plugin/fetch-manifest?plugin_unique_identifier=${uniqueIdentifier}`)
}

export const fetchManifestFromMarketPlace = async (uniqueIdentifier: string) => {
  return getMarketplace<{ data: { plugin: PluginManifestInMarket, version: { version: string } } }>(`/plugins/identifier?unique_identifier=${uniqueIdentifier}`)
}

export const fetchBundleInfoFromMarketPlace = async ({
  org,
  name,
  version,
}: Record<string, string>) => {
  return getMarketplace<{ data: { version: { dependencies: Dependency[] } } }>(`/bundles/${org}/${name}/${version}`)
}

export const fetchPluginInfoFromMarketPlace = async ({
  org,
  name,
}: Record<string, string>) => {
  return getMarketplace<{ data: { plugin: PluginInfoFromMarketPlace, version: { version: string } } }>(`/plugins/${org}/${name}`)
}

export const fetchMarketplaceCollections = ({ url }: { url: string }): Promise<MarketplaceCollectionsResponse> => {
  return get<MarketplaceCollectionsResponse>(url)
}

export const fetchMarketplaceCollectionPlugins = ({ url }: { url: string }): Promise<MarketplaceCollectionPluginsResponse> => {
  return get<MarketplaceCollectionPluginsResponse>(url)
}

export const fetchPluginTasks = async () => {
  return get<PluginTasksResponse>('/workspaces/current/plugin/tasks?page=1&page_size=255')
}

export const checkTaskStatus = async (taskId: string) => {
  return get<TaskStatusResponse>(`/workspaces/current/plugin/tasks/${taskId}`)
}

export const updatePermission = async (permissions: Permissions) => {
  return post('/workspaces/current/plugin/permission/change', { body: permissions })
}

export const uninstallPlugin = async (pluginId: string) => {
  return post<UninstallPluginResponse>('/workspaces/current/plugin/uninstall', { body: { plugin_installation_id: pluginId } })
}

export const checkInstalledPlugins = (pluginIds: string[]) => {
  return post<{ plugins: PluginDetail[] }>('/workspaces/current/plugin/list/installations/ids', {
    body: {
      plugin_ids: pluginIds,
    },
  })
}

export const fetchRecommendedMarketplacePlugins = (collection: string, limit: number) => {
  return postMarketplace<{ data: { plugins: Plugin[] } }>(`/collections/${collection}/plugins`, {
    body: {
      limit,
    },
  })
}

export const fetchInstalledPluginList = (page: number, pageSize: number) => {
  return get<InstalledPluginListWithTotalResponse>(`/workspaces/current/plugin/list?page=${page}&page_size=${pageSize}`)
}

export const fetchInstalledLatestVersion = (pluginIds: string[]) => {
  return post<InstalledLatestVersionResponse>('/workspaces/current/plugin/list/latest-versions', {
    body: {
      plugin_ids: pluginIds,
    },
  })
}

export const installPackageFromMarketplace = (uniqueIdentifier: string) => {
  return post<InstallPackageResponse>('/workspaces/current/plugin/install/marketplace', {
    body: { plugin_unique_identifiers: [uniqueIdentifier] },
  })
}

export const fetchPluginDeclarationFromMarketplace = (pluginUniqueIdentifier: string) => {
  return get<{ manifest: PluginDeclaration }>('/workspaces/current/plugin/marketplace/pkg', {
    params: { plugin_unique_identifier: pluginUniqueIdentifier },
  })
}

export const fetchPluginVersionList = (pluginID: string) => {
  return getMarketplace<{ data: VersionListResponse }>(`/plugins/${pluginID}/versions`, { params: { page: 1, page_size: 100 } })
}

export const installPackageFromLocal = (uniqueIdentifier: string) => {
  return post<InstallPackageResponse>('/workspaces/current/plugin/install/pkg', {
    body: { plugin_unique_identifiers: [uniqueIdentifier] },
  })
}

export const installPackageFromGitHub = (payload: { repoUrl: string, selectedVersion: string, selectedPackage: string, uniqueIdentifier: string }) => {
  const { repoUrl, selectedVersion, selectedPackage, uniqueIdentifier } = payload
  return post<InstallPackageResponse>('/workspaces/current/plugin/install/github', {
    body: {
      repo: repoUrl,
      version: selectedVersion,
      package: selectedPackage,
      plugin_unique_identifier: uniqueIdentifier,
    },
  })
}

export const uploadGitHubPackage = (payload: { repo: string, version: string, package: string }) => {
  return post<uploadGitHubResponse>('/workspaces/current/plugin/upload/github', {
    body: payload,
  })
}

export const fetchDebugKey = () => {
  return get<DebugInfo>('/workspaces/current/plugin/debugging-key')
}

export const fetchReferenceSettings = () => {
  return get<ReferenceSetting>('/workspaces/current/plugin/preferences/fetch')
}

export const updateReferenceSettings = (payload: ReferenceSetting) => {
  return post('/workspaces/current/plugin/preferences/change', { body: payload })
}

export const excludeAutoUpgrade = (payload: { plugin_id: string }) => {
  return post('/workspaces/current/plugin/preferences/autoupgrade/exclude', { body: payload })
}

export const searchMarketplacePlugins = (params: PluginsSearchParams) => {
  const {
    query,
    sortBy,
    sortOrder,
    category,
    tags,
    exclude,
    type,
    page = 1,
    pageSize = 40,
  } = params
  const pluginOrBundle = type === 'bundle' ? 'bundles' : 'plugins'
  return postMarketplace<{ data: PluginsFromMarketplaceResponse }>(`/${pluginOrBundle}/search/advanced`, {
    body: {
      page,
      page_size: pageSize,
      query,
      sort_by: sortBy,
      sort_order: sortOrder,
      category: category !== 'all' ? category : '',
      tags,
      exclude,
      type,
    },
  })
}

export const fetchMarketplacePluginsByIds = (unique_identifiers: string[]) => {
  return postMarketplace<{ data: PluginsFromMarketplaceResponse }>('/plugins/identifier/batch', {
    body: {
      unique_identifiers,
    },
  })
}

export const fetchMarketplacePluginsByInfo = (infos: Record<string, any>[]) => {
  return postMarketplace<{ data: PluginsFromMarketplaceByInfoResponse }>('/plugins/versions/batch', {
    body: {
      plugin_tuples: infos.map(info => ({
        org: info.organization,
        name: info.plugin,
        version: info.version,
      })),
    },
  })
}

export const fetchPluginTaskList = () => {
  return get<{ tasks: PluginTask[] }>('/workspaces/current/plugin/tasks?page=1&page_size=100')
}

export const deletePluginTask = (taskId: string, pluginId: string) => {
  const encodedPluginId = encodeURIComponent(pluginId)
  return post<{ success: boolean }>(`/workspaces/current/plugin/tasks/${taskId}/delete/${encodedPluginId}`)
}

export const deleteAllPluginTasks = () => {
  return post<{ success: boolean }>('/workspaces/current/plugin/tasks/delete_all')
}

export const fetchPluginManifestInfo = (pluginUID: string) => {
  return getMarketplace<{ data: { plugin: PluginInfoFromMarketPlace, version: { version: string } } }>(`/plugins/${pluginUID}`)
}

export const downloadPlugin = (info: { organization: string, pluginName: string, version: string }) => {
  return getMarketplace<Blob>(`/plugins/${info.organization}/${info.pluginName}/${info.version}/download`)
}

export const checkImportDependencies = (appId: string) => {
  return get<{ leaked_dependencies: Dependency[] }>(`/apps/imports/${appId}/check-dependencies`)
}

export const fetchPluginDynamicOptions = (params: {
  plugin_id: string
  provider: string
  action: string
  parameter: string
  provider_type?: string
  extra?: Record<string, any>
}) => {
  return get<{ options: FormOption[] }>('/workspaces/current/plugin/parameters/dynamic-options', {
    params: {
      plugin_id: params.plugin_id,
      provider: params.provider,
      action: params.action,
      parameter: params.parameter,
      provider_type: params.provider_type,
      ...params.extra,
    },
  })
}

export const fetchPluginReadme = (params: { plugin_unique_identifier: string, language?: string }) => {
  return get<{ readme: string }>('/workspaces/current/plugin/readme', { params }, { silent: true })
}

export const fetchPluginAsset = (params: { plugin_unique_identifier: string, file_name: string }) => {
  return get<Blob>('/workspaces/current/plugin/asset', { params }, { silent: true })
}
