import type {
  MarketplaceCollectionPluginsResponse,
  MarketplaceCollectionsResponse,
} from '@/app/components/plugins/marketplace/types'
import type {
  Dependency,
  InstallPackageResponse,
  Permissions,
  PluginDeclaration,
  PluginInfoFromMarketPlace,
  PluginManifestInMarket,
  PluginTasksResponse,
  TaskStatusResponse,
  UninstallPluginResponse,
  updatePackageResponse,
  uploadGitHubResponse,
} from '@/app/components/plugins/types'
import { get, getMarketplace, post, upload } from './base'

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
