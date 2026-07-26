import type { PluginInstallTask } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ConsoleClient } from './api/console-client'
import type { SeedContext, SeedResult } from './seed'
import { Buffer } from 'node:buffer'
import { ORPCError } from '@orpc/client'
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

const resolveLatestPluginIdentifiers = async (client: ConsoleClient, pluginIds: string[]) => {
  if (pluginIds.length === 0) return { identifiers: [] as string[], missing: [] as string[] }

  const body = await client.workspaces.current.plugin.list.latestVersions.post({
    body: { plugin_ids: pluginIds },
  })
  const identifiers: string[] = []
  const missing: string[] = []

  for (const pluginId of pluginIds) {
    const latest = body.versions[pluginId]
    if (latest?.unique_identifier) identifiers.push(latest.unique_identifier)
    else missing.push(pluginId)
  }

  return { identifiers, missing }
}

const listInstalledPlugins = async (client: ConsoleClient, pluginIds: string[]) => {
  if (pluginIds.length === 0) return []

  return (
    await client.workspaces.current.plugin.list.installations.ids.post({
      body: { plugin_ids: pluginIds },
    })
  ).plugins
}

const waitForPluginInstallTask = async (
  client: ConsoleClient,
  taskId: string,
  timeoutMs = 300_000,
) => {
  const deadline = Date.now() + timeoutMs
  let lastTask: PluginInstallTask | undefined

  while (Date.now() < deadline) {
    lastTask = (
      await client.workspaces.current.plugin.tasks.byTaskId.get({
        params: { task_id: taskId },
      })
    ).task

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

const uploadMarketplacePluginPackage = async (
  client: ConsoleClient,
  pluginUniqueIdentifier: string,
) => {
  const pkg = await downloadMarketplacePluginPackage(pluginUniqueIdentifier)
  const fileName = `${getPluginId(pluginUniqueIdentifier).replaceAll('/', '-')}.difypkg`
  const response = await client.workspaces.current.plugin.upload.pkg.post({
    body: {
      pkg: new File([Uint8Array.from(pkg)], fileName, { type: 'application/octet-stream' }),
    },
  })
  return response.unique_identifier
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const getMarketplaceInstallErrorText = (error: unknown) => {
  const messages = [error instanceof Error ? error.message : String(error)]

  if (error instanceof ORPCError && isRecord(error.data)) {
    const body = error.data.body
    if (isRecord(body) && typeof body.message === 'string') messages.push(body.message)
  }

  return messages.join('\n')
}

const shouldFallbackToLocalPackageInstall = (error: unknown) => {
  const message = getMarketplaceInstallErrorText(error)
  return message.includes('/plugins/download') || message.includes('Reached maximum retries')
}

const installMarketplacePluginsWithFallback = async (
  client: ConsoleClient,
  pluginUniqueIdentifiers: string[],
) => {
  try {
    return await client.workspaces.current.plugin.install.marketplace.post({
      body: { plugin_unique_identifiers: pluginUniqueIdentifiers },
    })
  } catch (error) {
    if (!shouldFallbackToLocalPackageInstall(error)) throw error

    console.warn(
      '[seed] marketplace install download failed in API process; falling back to local package upload.',
    )
    const uploadedPluginUniqueIdentifiers: string[] = []
    for (const pluginUniqueIdentifier of pluginUniqueIdentifiers)
      uploadedPluginUniqueIdentifiers.push(
        await uploadMarketplacePluginPackage(client, pluginUniqueIdentifier),
      )

    return await client.workspaces.current.plugin.install.pkg.post({
      body: { plugin_unique_identifiers: uploadedPluginUniqueIdentifiers },
    })
  }
}

export const bootstrapMarketplacePlugins = async (
  context: SeedContext,
  config: MarketplacePluginBootstrapConfig,
): Promise<SeedResult> => {
  const requestedPluginIds = parseListEnv(config.pluginIdsEnv)
  const client = context.consoleClient
  const pluginIds = unique(
    requestedPluginIds.length > 0 ? requestedPluginIds : config.defaultPluginIds,
  )

  if (pluginIds.length > 0) {
    const installedPlugins = await listInstalledPlugins(client, pluginIds)
    const installedPluginIds = new Set(installedPlugins.map((plugin) => plugin.plugin_id))
    if (pluginIds.every((pluginId) => installedPluginIds.has(pluginId))) {
      return verified(config.title, {
        id: pluginIds.join(','),
        kind: 'marketplace-plugins',
        name: config.title,
      })
    }
  }

  const resolved = await resolveLatestPluginIdentifiers(client, pluginIds)

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

  const installedPlugins = await listInstalledPlugins(client, requiredPluginIds)
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
    client,
    missingPluginUniqueIdentifiers,
  ).catch((error) => {
    return { error: getMarketplaceInstallErrorText(error) }
  })
  if ('error' in startedTask) return blocked(config.title, startedTask.error)

  if (startedTask.all_installed) return verified(config.title, resource)

  const taskId = startedTask.task_id || startedTask.task?.id
  if (!taskId) return blocked(config.title, 'Marketplace plugin install did not return a task id.')

  const taskResult = await waitForPluginInstallTask(client, taskId)
  if (!taskResult.ok) return blocked(config.title, taskResult.reason)

  return created(config.title, resource)
}
