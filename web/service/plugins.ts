import type {
  Dependency,
  InstallPackageResponse,
  PluginInfoFromMarketPlace,
  PluginManifestInMarket,
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

export const checkTaskStatus = async (taskId: string) => {
  return get<TaskStatusResponse>(`/workspaces/current/plugin/tasks/${taskId}`)
}

export const uninstallPlugin = async (pluginId: string) => {
  return post<UninstallPluginResponse>('/workspaces/current/plugin/uninstall', { body: { plugin_installation_id: pluginId } })
}
