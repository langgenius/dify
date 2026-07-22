import type { PluginInstallTask } from '@dify/contracts/api/console/workspaces/types.gen'
import type { SeedContext, SeedResult } from './seed'
import { Buffer } from 'node:buffer'
import {
  getInstalledMarketplacePlugins,
  getLatestMarketplacePluginVersions,
  getMarketplacePluginInstallTask,
  startMarketplacePluginInstall,
  startUploadedPluginPackageInstall,
  uploadMarketplacePluginPackageFile,
} from './api/marketplace-plugins'
import { sleep } from './process'
import { blocked, created, skipped, verified } from './seed'

type MarketplacePluginBootstrapConfig = {
  defaultPluginIds: string[]
  pluginIdsEnv: string
  title: string
}

const pendingTaskStatuses = new Set(['pending', 'running'])
const terminalSuccessTaskStatus = 'success'
const terminalFailedTaskStatus = 'failed'
const defaultMarketplaceApiUrl = 'https://marketplace.dify.ai'

const parseListEnv = (envName: string) =>
  process.env[envName]
    ?.split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean) ?? []

const unique = (values: string[]) => Array.from(new Set(values))

const getPluginId = (pluginUniqueIdentifier: string) =>
  pluginUniqueIdentifier.split(':')[0]?.trim() || pluginUniqueIdentifier.trim()

const resolveLatestPluginIdentifiers = async (pluginIds: string[]) => {
  if (pluginIds.length === 0) return { identifiers: [] as string[], missing: [] as string[] }

  const body = await getLatestMarketplacePluginVersions(pluginIds)
  const identifiers: string[] = []
  const missing: string[] = []

  for (const pluginId of pluginIds) {
    const latest = body.versions[pluginId]
    if (latest?.unique_identifier) identifiers.push(latest.unique_identifier)
    else missing.push(pluginId)
  }

  return { identifiers, missing }
}

const listInstalledPlugins = async (pluginIds: string[]) => {
  if (pluginIds.length === 0) return []

  return (await getInstalledMarketplacePlugins(pluginIds)).plugins
}

const waitForPluginInstallTask = async (taskId: string, timeoutMs = 300_000) => {
  const deadline = Date.now() + timeoutMs
  let lastTask: PluginInstallTask | undefined

  while (Date.now() < deadline) {
    lastTask = (await getMarketplacePluginInstallTask(taskId)).task

    if (lastTask?.status === terminalSuccessTaskStatus) return { ok: true as const, task: lastTask }

    if (lastTask?.status === terminalFailedTaskStatus) {
      const details = lastTask.plugins
        ?.filter((plugin) => plugin.status === terminalFailedTaskStatus)
        .map(
          (plugin) =>
            `${plugin.plugin_id ?? plugin.plugin_unique_identifier ?? 'unknown'}: ${plugin.message ?? 'failed'}`,
        )
        .join('; ')
      return { ok: false as const, reason: details || 'Plugin install task failed.' }
    }

    if (!lastTask?.status || pendingTaskStatuses.has(lastTask.status)) {
      await sleep(2_000)
      continue
    }

    return {
      ok: false as const,
      reason: `Plugin install task ended with status ${lastTask.status}.`,
    }
  }

  return { ok: false as const, reason: `Plugin install task did not finish within ${timeoutMs}ms.` }
}

const installMarketplacePlugins = async (pluginUniqueIdentifiers: string[]) => {
  return startMarketplacePluginInstall(pluginUniqueIdentifiers)
}

const getMarketplaceDownloadUrl = (pluginUniqueIdentifier: string) => {
  const url = new URL(
    '/api/v1/plugins/download',
    process.env.E2E_MARKETPLACE_API_URL || defaultMarketplaceApiUrl,
  )
  url.searchParams.set('unique_identifier', pluginUniqueIdentifier)
  return url.toString()
}

const downloadMarketplacePluginPackage = async (pluginUniqueIdentifier: string) => {
  const response = await fetch(getMarketplaceDownloadUrl(pluginUniqueIdentifier))
  if (!response.ok) {
    throw new Error(
      `Download marketplace package for ${getPluginId(pluginUniqueIdentifier)} failed with ${response.status} ${response.statusText}.`,
    )
  }

  return Buffer.from(await response.arrayBuffer())
}

const uploadMarketplacePluginPackage = async (pluginUniqueIdentifier: string) => {
  const pkg = await downloadMarketplacePluginPackage(pluginUniqueIdentifier)
  const fileName = `${getPluginId(pluginUniqueIdentifier).replaceAll('/', '-')}.difypkg`
  return (await uploadMarketplacePluginPackageFile(pkg, fileName)).unique_identifier
}

const installLocalPluginPackages = async (pluginUniqueIdentifiers: string[]) => {
  return startUploadedPluginPackageInstall(pluginUniqueIdentifiers)
}

const shouldFallbackToLocalPackageInstall = (error: string) =>
  error.includes('/plugins/download') || error.includes('Reached maximum retries')

const installMarketplacePluginsWithFallback = async (pluginUniqueIdentifiers: string[]) => {
  try {
    return await installMarketplacePlugins(pluginUniqueIdentifiers)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!shouldFallbackToLocalPackageInstall(message)) throw error

    console.warn(
      '[seed] marketplace install download failed in API process; falling back to local package upload.',
    )
    const uploadedPluginUniqueIdentifiers: string[] = []
    for (const pluginUniqueIdentifier of pluginUniqueIdentifiers)
      uploadedPluginUniqueIdentifiers.push(
        await uploadMarketplacePluginPackage(pluginUniqueIdentifier),
      )

    return await installLocalPluginPackages(uploadedPluginUniqueIdentifiers)
  }
}

export const bootstrapMarketplacePlugins = async (
  context: SeedContext,
  config: MarketplacePluginBootstrapConfig,
): Promise<SeedResult> => {
  const requestedPluginIds = parseListEnv(config.pluginIdsEnv)
  const pluginIds = unique(
    requestedPluginIds.length > 0 ? requestedPluginIds : config.defaultPluginIds,
  )

  if (pluginIds.length > 0) {
    const installedPlugins = await listInstalledPlugins(pluginIds)
    const installedPluginIds = new Set(installedPlugins.map((plugin) => plugin.plugin_id))
    if (pluginIds.every((pluginId) => installedPluginIds.has(pluginId))) {
      return verified(config.title, {
        id: pluginIds.join(','),
        kind: 'marketplace-plugins',
        name: config.title,
      })
    }
  }

  const resolved = await resolveLatestPluginIdentifiers(pluginIds)

  if (resolved.missing.length > 0) {
    return blocked(
      config.title,
      `Marketplace metadata was not found for plugin ids: ${resolved.missing.join(', ')}.`,
    )
  }

  const requiredPluginUniqueIdentifiers = unique(resolved.identifiers)
  const requiredPluginIds = unique(requiredPluginUniqueIdentifiers.map(getPluginId))

  if (requiredPluginUniqueIdentifiers.length === 0)
    return skipped(config.title, 'No marketplace plugins were requested.')

  const installedPlugins = await listInstalledPlugins(requiredPluginIds)
  const installedPluginIds = new Set(installedPlugins.map((plugin) => plugin.plugin_id))
  const missingPluginUniqueIdentifiers = requiredPluginUniqueIdentifiers.filter(
    (identifier) => !installedPluginIds.has(getPluginId(identifier)),
  )
  const resource = {
    id: requiredPluginIds.join(','),
    kind: 'marketplace-plugins',
    name: config.title,
  }

  if (missingPluginUniqueIdentifiers.length === 0) return verified(config.title, resource)

  if (context.dryRun) {
    return skipped(
      config.title,
      `Would install marketplace plugins: ${missingPluginUniqueIdentifiers.map(getPluginId).join(', ')}.`,
    )
  }

  const startedTask = await installMarketplacePluginsWithFallback(
    missingPluginUniqueIdentifiers,
  ).catch((error) => {
    return { error: error instanceof Error ? error.message : String(error) }
  })
  if ('error' in startedTask) return blocked(config.title, startedTask.error)

  if (startedTask.all_installed) return verified(config.title, resource)

  const taskId = startedTask.task_id || startedTask.task?.id
  if (!taskId) return blocked(config.title, 'Marketplace plugin install did not return a task id.')

  const taskResult = await waitForPluginInstallTask(taskId)
  if (!taskResult.ok) return blocked(config.title, taskResult.reason)

  return created(config.title, resource)
}
