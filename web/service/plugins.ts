import { consoleClient } from '@/service/console'
import { marketplaceClient } from '@/service/marketplace'

export const uploadFile = async (file: File, isBundle: boolean): Promise<unknown> => {
  // Packages can be large: the upload transport keeps the legacy XHR behavior of no client timeout.
  const options = { context: { onUploadProgress: () => {} } }
  return isBundle
    ? consoleClient.workspaces.current.plugin.upload.bundle.post(
        { body: { bundle: file } },
        options,
      )
    : consoleClient.workspaces.current.plugin.upload.pkg.post({ body: { pkg: file } }, options)
}

export const updateFromGitHub = async (
  repoUrl: string,
  selectedVersion: string,
  selectedPackage: string,
  originalPlugin: string,
  newPlugin: string,
) => {
  return consoleClient.workspaces.current.plugin.upgrade.github.post({
    body: {
      repo: repoUrl,
      version: selectedVersion,
      package: selectedPackage,
      original_plugin_unique_identifier: originalPlugin,
      new_plugin_unique_identifier: newPlugin,
    },
  })
}

export const uploadGitHub = async (
  repoUrl: string,
  selectedVersion: string,
  selectedPackage: string,
) => {
  return consoleClient.workspaces.current.plugin.upload.github.post({
    body: {
      repo: repoUrl,
      version: selectedVersion,
      package: selectedPackage,
    },
  })
}

export const fetchManifestFromMarketPlace = async (uniqueIdentifier: string) => {
  return marketplaceClient.pluginByIdentifier({
    query: { unique_identifier: uniqueIdentifier },
  })
}

export const fetchBundleInfoFromMarketPlace = async ({
  org,
  name,
  version,
}: Record<string, string>) => {
  return marketplaceClient.bundleDetail({
    params: { organization: org!, bundleName: name!, version: version! },
  })
}

export const fetchPluginInfoFromMarketPlace = async ({ org, name }: Record<string, string>) => {
  return marketplaceClient.pluginDetail({
    params: { organization: org!, pluginName: name! },
  })
}

export const checkTaskStatus = async (taskId: string) => {
  return consoleClient.workspaces.current.plugin.tasks.byTaskId.get({ params: { task_id: taskId } })
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
