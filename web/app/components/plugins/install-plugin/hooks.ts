import Toast, { type IToastProps } from '@/app/components/base/toast'
import { uploadGitHub } from '@/service/plugins'
import { compareVersion, getLatestVersion } from '@/utils/semver'
import type { GitHubRepoReleaseResponse } from '../types'
import { GITHUB_ACCESS_TOKEN } from '@/config'

const formatReleases = (releases: any) => {
  return releases.map((release: any) => ({
    tag_name: release.tag_name,
    assets: release.assets.map((asset: any) => ({
      browser_download_url: asset.browser_download_url,
      name: asset.name,
    })),
  }))
}

export const useGitHubReleases = () => {
  const fetchReleases = async (owner: string, repo: string) => {
    try {
      if (!GITHUB_ACCESS_TOKEN) {
        // Fetch releases without authentication from client
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`)
        if (!res.ok) throw new Error('Failed to fetch repository releases')
        const data = await res.json()
        return formatReleases(data)
      }
      else {
        // Fetch releases with authentication from server
        const res = await fetch(`/repos/${owner}/${repo}/releases`)
        const bodyJson = await res.json()
        if (bodyJson.status !== 200) throw new Error(bodyJson.data.message)
        return formatReleases(bodyJson.data)
      }
    }
    catch (error) {
      if (error instanceof Error) {
        Toast.notify({
          type: 'error',
          message: error.message,
        })
      }
      else {
        Toast.notify({
          type: 'error',
          message: 'Failed to fetch repository releases',
        })
      }
      return []
    }
  }

  const checkForUpdates = (fetchedReleases: GitHubRepoReleaseResponse[], currentVersion: string) => {
    let needUpdate = false
    const toastProps: IToastProps = {
      type: 'info',
      message: 'No new version available',
    }
    if (fetchedReleases.length === 0) {
      toastProps.type = 'error'
      toastProps.message = 'Input releases is empty'
      return { needUpdate, toastProps }
    }
    const versions = fetchedReleases.map(release => release.tag_name)
    const latestVersion = getLatestVersion(versions)
    try {
      needUpdate = compareVersion(latestVersion, currentVersion) === 1
      if (needUpdate)
        toastProps.message = `New version available: ${latestVersion}`
    }
    catch {
      needUpdate = false
      toastProps.type = 'error'
      toastProps.message = 'Fail to compare versions, please check the version format'
    }
    return { needUpdate, toastProps }
  }

  return { fetchReleases, checkForUpdates }
}

export const useGitHubUpload = () => {
  const handleUpload = async (
    repoUrl: string,
    selectedVersion: string,
    selectedPackage: string,
    onSuccess?: (GitHubPackage: { manifest: any; unique_identifier: string }) => void,
  ) => {
    try {
      const response = await uploadGitHub(repoUrl, selectedVersion, selectedPackage)
      const GitHubPackage = {
        manifest: response.manifest,
        unique_identifier: response.unique_identifier,
      }
      if (onSuccess) onSuccess(GitHubPackage)
      return GitHubPackage
    }
    catch (error) {
      Toast.notify({
        type: 'error',
        message: 'Error uploading package',
      })
      throw error
    }
  }

  return { handleUpload }
}
