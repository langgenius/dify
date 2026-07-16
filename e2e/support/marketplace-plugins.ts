import type { SeedContext, SeedResult } from './seed'
import { Buffer } from 'node:buffer'
import { createApiContext, expectApiResponseOK } from './api'
import { sleep } from './process'
import { blocked, created, skipped, verified } from './seed'

type LatestPlugin = {
  unique_identifier?: string
  version?: string
}

type PluginInstallation = {
  plugin_id: string
  plugin_unique_identifier: string
}

type PluginInstallTask = {
  id?: string
  plugins?: Array<{
    message?: string
    plugin_id?: string
    plugin_unique_identifier?: string
    status?: string
  }>
  status?: string
}

type PluginInstallStartResponse = {
  all_installed?: boolean
  task?: PluginInstallTask | null
  task_id?: string
}

type MarketplacePluginBootstrapConfig = {
  defaultPluginIds: string[]
  pluginIdsEnv: string
  pluginUniqueIdentifiersEnv: string
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

const findPlaceholderPluginIdentifier = (pluginUniqueIdentifiers: string[]) =>
  pluginUniqueIdentifiers.find((identifier) => identifier.includes('replace-with-'))

const withoutPlaceholderPluginIdentifiers = (pluginUniqueIdentifiers: string[]) =>
  pluginUniqueIdentifiers.filter((identifier) => !identifier.includes('replace-with-'))

const resolveLatestPluginIdentifiers = async (pluginIds: string[]) => {
  if (pluginIds.length === 0) return { identifiers: [] as string[], missing: [] as string[] }

  const ctx = await createApiContext()
  try {
    const response = await ctx.post('/console/api/workspaces/current/plugin/list/latest-versions', {
      data: { plugin_ids: pluginIds },
    })
    await expectApiResponseOK(response, 'Resolve latest marketplace plugin versions')
    const body = (await response.json()) as { versions?: Record<string, LatestPlugin | null> }
    const identifiers: string[] = []
    const missing: string[] = []

    for (const pluginId of pluginIds) {
      const latest = body.versions?.[pluginId]
      if (latest?.unique_identifier) identifiers.push(latest.unique_identifier)
      else missing.push(pluginId)
    }

    return { identifiers, missing }
  } finally {
    await ctx.dispose()
  }
}

const listInstalledPlugins = async (pluginIds: string[]) => {
  if (pluginIds.length === 0) return [] as PluginInstallation[]

  const ctx = await createApiContext()
  try {
    const response = await ctx.post(
      '/console/api/workspaces/current/plugin/list/installations/ids',
      {
        data: { plugin_ids: pluginIds },
      },
    )
    await expectApiResponseOK(response, 'List installed marketplace plugins')
    const body = (await response.json()) as { plugins?: PluginInstallation[] }
    return body.plugins ?? []
  } finally {
    await ctx.dispose()
  }
}

const waitForPluginInstallTask = async (taskId: string, timeoutMs = 300_000) => {
  const deadline = Date.now() + timeoutMs
  let lastTask: PluginInstallTask | undefined

  while (Date.now() < deadline) {
    const ctx = await createApiContext()
    try {
      const response = await ctx.get(`/console/api/workspaces/current/plugin/tasks/${taskId}`)
      await expectApiResponseOK(response, `Fetch marketplace plugin install task ${taskId}`)
      const body = (await response.json()) as { task?: PluginInstallTask }
      lastTask = body.task
    } finally {
      await ctx.dispose()
    }

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
  const ctx = await createApiContext()
  try {
    const response = await ctx.post('/console/api/workspaces/current/plugin/install/marketplace', {
      data: { plugin_unique_identifiers: pluginUniqueIdentifiers },
    })
    await expectApiResponseOK(response, 'Install marketplace plugins')
    return (await response.json()) as PluginInstallStartResponse
  } finally {
    await ctx.dispose()
  }
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
  const ctx = await createApiContext()
  try {
    const response = await ctx.post('/console/api/workspaces/current/plugin/upload/pkg', {
      multipart: {
        pkg: {
          buffer: pkg,
          mimeType: 'application/octet-stream',
          name: `${getPluginId(pluginUniqueIdentifier).replaceAll('/', '-')}.difypkg`,
        },
      },
    })
    await expectApiResponseOK(
      response,
      `Upload marketplace package ${getPluginId(pluginUniqueIdentifier)}`,
    )
    const body = (await response.json()) as { unique_identifier?: string }
    if (!body.unique_identifier)
      throw new Error(
        `Upload marketplace package ${getPluginId(pluginUniqueIdentifier)} did not return a unique identifier.`,
      )

    return body.unique_identifier
  } finally {
    await ctx.dispose()
  }
}

const installLocalPluginPackages = async (pluginUniqueIdentifiers: string[]) => {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post('/console/api/workspaces/current/plugin/install/pkg', {
      data: { plugin_unique_identifiers: pluginUniqueIdentifiers },
    })
    await expectApiResponseOK(response, 'Install uploaded plugin packages')
    return (await response.json()) as PluginInstallStartResponse
  } finally {
    await ctx.dispose()
  }
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
  const rawExactPluginUniqueIdentifiers = unique(parseListEnv(config.pluginUniqueIdentifiersEnv))
  const exactPluginUniqueIdentifiers = withoutPlaceholderPluginIdentifiers(
    rawExactPluginUniqueIdentifiers,
  )
  const placeholderPluginIdentifier = findPlaceholderPluginIdentifier(
    rawExactPluginUniqueIdentifiers,
  )
  if (placeholderPluginIdentifier) {
    console.warn(
      `[seed] ignoring example marketplace package placeholder for ${getPluginId(placeholderPluginIdentifier)}.`,
    )
  }

  const pluginIds = unique(
    exactPluginUniqueIdentifiers.length > 0
      ? []
      : requestedPluginIds.length > 0
        ? requestedPluginIds
        : config.defaultPluginIds,
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
      `Marketplace metadata was not found for plugin ids: ${resolved.missing.join(', ')}. Set ${config.pluginUniqueIdentifiersEnv} to exact package identifiers to bypass latest-version lookup.`,
    )
  }

  const requiredPluginUniqueIdentifiers = unique([
    ...resolved.identifiers,
    ...exactPluginUniqueIdentifiers,
  ])
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
