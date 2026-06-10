import type { InstalledLatestVersionResponse, PluginDetail } from '@/app/components/plugins/types'
import { type } from '@orpc/contract'
import { base } from '../base'

export const pluginCheckInstalledContract = base
  .route({
    path: '/workspaces/current/plugin/list/installations/ids',
    method: 'POST',
  })
  .input(type<{
    body: {
      plugin_ids: string[]
    }
  }>())
  .output(type<{ plugins: PluginDetail[] }>())

export const pluginLatestVersionsContract = base
  .route({
    path: '/workspaces/current/plugin/list/latest-versions',
    method: 'POST',
  })
  .input(type<{
    body: {
      plugin_ids: string[]
    }
  }>())
  .output(type<InstalledLatestVersionResponse>())
