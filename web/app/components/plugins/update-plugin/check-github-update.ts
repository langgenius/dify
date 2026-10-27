import type { PluginDetail } from '../types'
import type { useModalContext } from '@/context/modal-context'
import { toast } from '@/app/notifications'
import { checkForUpdates, fetchReleases } from '../install-plugin/hooks'

export async function checkGitHubPluginUpdate(
  detail: PluginDetail,
  showUpdateModal: ReturnType<typeof useModalContext>['setShowUpdatePluginModal'],
  onUpdated: () => void | Promise<void>,
) {
  const { meta } = detail
  const { author, category, name } = detail.declaration || detail
  if (!meta?.repo || !meta?.version || !meta?.package) {
    toast.error('Missing plugin metadata for GitHub update')
    return
  }

  const owner = meta.repo.split('/')[0] || author
  const repo = meta.repo.split('/')[1] || name
  const fetchedReleases = await fetchReleases(owner, repo)
  if (fetchedReleases.length === 0) return

  const { needUpdate, toastProps } = checkForUpdates(fetchedReleases, meta.version)
  toast(toastProps.message, { type: toastProps.type })

  if (needUpdate) {
    showUpdateModal({
      onSaveCallback: () => onUpdated(),
      payload: {
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
      },
    })
  }
}
