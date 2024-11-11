import type { Fetcher } from 'swr'
import { get, getMarketplace, post, upload } from './base'
import type {
  InstallPackageResponse,
  Permissions,
  PluginDeclaration,
  PluginManifestInMarket,
  PluginTasksResponse,
  TaskStatusResponse,
  UninstallPluginResponse,
  uploadGitHubResponse,
} from '@/app/components/plugins/types'
import type {
  MarketplaceCollectionPluginsResponse,
  MarketplaceCollectionsResponse,
} from '@/app/components/plugins/marketplace/types'

export const uploadPackageFile = async (file: File) => {
  const formData = new FormData()
  formData.append('pkg', file)
  return upload({
    xhr: new XMLHttpRequest(),
    data: formData,
  }, false, '/workspaces/current/plugin/upload/pkg')
}

export const updateFromMarketPlace = async (body: Record<string, string>) => {
  return post<InstallPackageResponse>('/workspaces/current/plugin/upgrade/marketplace', {
    body,
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

export const installPackageFromGitHub = async (repoUrl: string, selectedVersion: string, selectedPackage: string, uniqueIdentifier: string) => {
  return post<InstallPackageResponse>('/workspaces/current/plugin/install/github', {
    body: {
      repo: repoUrl,
      version: selectedVersion,
      package: selectedPackage,
      plugin_unique_identifier: uniqueIdentifier,
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
  return getMarketplace<{ data: { plugin: PluginManifestInMarket } }>(`/plugins/identifier?unique_identifier=${uniqueIdentifier}`)
}

export const fetchMarketplaceCollections: Fetcher<MarketplaceCollectionsResponse, { url: string; }> = ({ url }) => {
  return get<MarketplaceCollectionsResponse>(url)
}

export const fetchMarketplaceCollectionPlugins: Fetcher<MarketplaceCollectionPluginsResponse, { url: string }> = ({ url }) => {
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
