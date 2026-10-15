import type { ParserMarketplaceUpgrade } from '@dify/contracts/api/console/workspaces/types.gen'
import type { PluginInfoFromMarketPlace } from '@dify/contracts/marketplace'
import type {
  Dependency,
  InstallPackageResponse,
  PluginManifestInMarket,
  TaskStatusResponse,
  updatePackageResponse,
  uploadGitHubResponse,
} from '@/app/components/plugins/types'
import { consoleClient } from '@/service/console'
import { getMarketplace, upload } from './base'
import { narrowResponse } from './console/narrow-response'

export const uploadFile = async (file: File, isBundle: boolean) => {
  const formData = new FormData()
  formData.append(isBundle ? 'bundle' : 'pkg', file)
  return upload(
    {
      xhr: new XMLHttpRequest(),
      data: formData,
    },
    false,
    `/workspaces/current/plugin/upload/${isBundle ? 'bundle' : 'pkg'}`,
  )
}

export const updateFromMarketPlace = async (body: ParserMarketplaceUpgrade) => {
  return narrowResponse<InstallPackageResponse>(
    consoleClient.workspaces.current.plugin.upgrade.marketplace.post({ body }),
  )
}

export const updateFromGitHub = async (
  repoUrl: string,
  selectedVersion: string,
  selectedPackage: string,
  originalPlugin: string,
  newPlugin: string,
) => {
  return narrowResponse<updatePackageResponse>(
    consoleClient.workspaces.current.plugin.upgrade.github.post({
      body: {
        repo: repoUrl,
        version: selectedVersion,
        package: selectedPackage,
        original_plugin_unique_identifier: originalPlugin,
        new_plugin_unique_identifier: newPlugin,
      },
    }),
  )
}

export const uploadGitHub = async (
  repoUrl: string,
  selectedVersion: string,
  selectedPackage: string,
) => {
  return narrowResponse<uploadGitHubResponse>(
    consoleClient.workspaces.current.plugin.upload.github.post({
      body: {
        repo: repoUrl,
        version: selectedVersion,
        package: selectedPackage,
      },
    }),
  )
}

export const fetchManifestFromMarketPlace = async (uniqueIdentifier: string) => {
  return getMarketplace<{ data: { plugin: PluginManifestInMarket; version: { version: string } } }>(
    `/plugins/identifier?unique_identifier=${uniqueIdentifier}`,
  )
}

export const fetchBundleInfoFromMarketPlace = async ({
  org,
  name,
  version,
}: Record<string, string>) => {
  return getMarketplace<{ data: { version: { dependencies: Dependency[] } } }>(
    `/bundles/${org}/${name}/${version}`,
  )
}

export const fetchPluginInfoFromMarketPlace = async ({ org, name }: Record<string, string>) => {
  return getMarketplace<{
    data: { plugin: PluginInfoFromMarketPlace; version: { version: string } }
  }>(`/plugins/${org}/${name}`)
}

export const checkTaskStatus = async (taskId: string) => {
  return narrowResponse<TaskStatusResponse>(
    consoleClient.workspaces.current.plugin.tasks.byTaskId.get({ params: { task_id: taskId } }),
  )
}

export const uninstallPlugin = async (
  pluginId: string,
  options: { preserveCredentials?: boolean } = {},
) => {
  return consoleClient.workspaces.current.plugin.uninstall.post({
    body: {
      plugin_installation_id: pluginId,
      preserve_credentials: options.preserveCredentials ?? false,
    },
  })
}
