import type { QueryClient } from '@tanstack/react-query'
import type { PluginDeclaration, PluginDetail } from '../types'
import { getI18n } from 'react-i18next'
import { toast } from '@/app/notifications'
import { checkForUpdates, fetchReleases } from '../install-plugin/hooks'

const latestIntents = new WeakMap<QueryClient, symbol>()

export function beginGitHubPluginIntent(client: QueryClient) {
  const intent = Symbol('GitHub plugin request')
  latestIntents.set(client, intent)
  return () => latestIntents.get(client) === intent
}

type GitHubPlugin = Pick<PluginDetail, 'meta' | 'plugin_unique_identifier'> & {
  declaration: Pick<PluginDeclaration, 'author' | 'category' | 'name'>
}

export async function checkGitHubPluginUpdate(detail: GitHubPlugin, isCurrent: () => boolean) {
  if (!isCurrent()) return
  const { meta } = detail
  const { author, category, name } = detail.declaration || detail
  if (!meta?.repo || !meta?.version || !meta?.package) {
    toast.error('Missing plugin metadata for GitHub update')
    return
  }

  const owner = meta.repo.split('/')[0] || author
  const repo = meta.repo.split('/')[1] || name
  const fetchedReleases = await fetchReleases(owner, repo).catch(() => {
    if (isCurrent())
      toast.error(getI18n().t(($) => $['error.fetchReleasesError'], { ns: 'plugin' }))
    return undefined
  })
  if (!isCurrent() || !fetchedReleases?.length) return

  const { needUpdate, toastProps } = checkForUpdates(fetchedReleases, meta.version)
  toast(toastProps.message, { type: toastProps.type })

  if (needUpdate) {
    return {
      category,
      github: {
        originalPackageInfo: {
          id: detail.plugin_unique_identifier,
          repo: meta.repo,
          version: meta.version,
          package: meta.package,
          releases: fetchedReleases,
        },
      },
    }
  }
}
