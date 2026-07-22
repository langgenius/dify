import type {
  GetWorkspacesCurrentPluginTasksByTaskIdResponse,
  ParserLatest,
  ParserPluginIdentifiers,
  PostWorkspacesCurrentPluginInstallMarketplaceResponse,
  PostWorkspacesCurrentPluginInstallPkgResponse,
  PostWorkspacesCurrentPluginListInstallationsIdsResponse,
  PostWorkspacesCurrentPluginListLatestVersionsResponse,
  PostWorkspacesCurrentPluginUploadPkgResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { Buffer } from 'node:buffer'
import {
  zGetWorkspacesCurrentPluginTasksByTaskIdResponse,
  zPostWorkspacesCurrentPluginInstallMarketplaceResponse,
  zPostWorkspacesCurrentPluginInstallPkgResponse,
  zPostWorkspacesCurrentPluginListInstallationsIdsResponse,
  zPostWorkspacesCurrentPluginListLatestVersionsResponse,
  zPostWorkspacesCurrentPluginUploadPkgResponse,
} from '@dify/contracts/api/console/workspaces/zod.gen'
import { createConsoleApiContext, expectApiResponseOK } from './console-context'

export async function getLatestMarketplacePluginVersions(
  pluginIds: string[],
): Promise<PostWorkspacesCurrentPluginListLatestVersionsResponse> {
  const ctx = await createConsoleApiContext()
  try {
    const data = { plugin_ids: pluginIds } satisfies ParserLatest
    const response = await ctx.post('/console/api/workspaces/current/plugin/list/latest-versions', {
      data,
    })
    await expectApiResponseOK(response, 'Resolve latest marketplace plugin versions')
    return zPostWorkspacesCurrentPluginListLatestVersionsResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}

export async function getInstalledMarketplacePlugins(
  pluginIds: string[],
): Promise<PostWorkspacesCurrentPluginListInstallationsIdsResponse> {
  const ctx = await createConsoleApiContext()
  try {
    const data = { plugin_ids: pluginIds } satisfies ParserLatest
    const response = await ctx.post(
      '/console/api/workspaces/current/plugin/list/installations/ids',
      { data },
    )
    await expectApiResponseOK(response, 'List installed marketplace plugins')
    return zPostWorkspacesCurrentPluginListInstallationsIdsResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}

export async function getMarketplacePluginInstallTask(
  taskId: string,
): Promise<GetWorkspacesCurrentPluginTasksByTaskIdResponse> {
  const ctx = await createConsoleApiContext()
  try {
    const response = await ctx.get(`/console/api/workspaces/current/plugin/tasks/${taskId}`)
    await expectApiResponseOK(response, `Fetch marketplace plugin install task ${taskId}`)
    return zGetWorkspacesCurrentPluginTasksByTaskIdResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}

export async function startMarketplacePluginInstall(
  pluginUniqueIdentifiers: string[],
): Promise<PostWorkspacesCurrentPluginInstallMarketplaceResponse> {
  const ctx = await createConsoleApiContext()
  try {
    const data = {
      plugin_unique_identifiers: pluginUniqueIdentifiers,
    } satisfies ParserPluginIdentifiers
    const response = await ctx.post('/console/api/workspaces/current/plugin/install/marketplace', {
      data,
    })
    await expectApiResponseOK(response, 'Install marketplace plugins')
    return zPostWorkspacesCurrentPluginInstallMarketplaceResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}

export async function uploadMarketplacePluginPackageFile(
  pkg: Buffer,
  fileName: string,
): Promise<PostWorkspacesCurrentPluginUploadPkgResponse> {
  const ctx = await createConsoleApiContext()
  try {
    const response = await ctx.post('/console/api/workspaces/current/plugin/upload/pkg', {
      multipart: {
        pkg: {
          buffer: pkg,
          mimeType: 'application/octet-stream',
          name: fileName,
        },
      },
    })
    await expectApiResponseOK(response, `Upload marketplace package ${fileName}`)
    return zPostWorkspacesCurrentPluginUploadPkgResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}

export async function startUploadedPluginPackageInstall(
  pluginUniqueIdentifiers: string[],
): Promise<PostWorkspacesCurrentPluginInstallPkgResponse> {
  const ctx = await createConsoleApiContext()
  try {
    const data = {
      plugin_unique_identifiers: pluginUniqueIdentifiers,
    } satisfies ParserPluginIdentifiers
    const response = await ctx.post('/console/api/workspaces/current/plugin/install/pkg', { data })
    await expectApiResponseOK(response, 'Install uploaded plugin packages')
    return zPostWorkspacesCurrentPluginInstallPkgResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}
