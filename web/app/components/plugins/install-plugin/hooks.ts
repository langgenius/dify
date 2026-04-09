import type { GitHubRepoReleaseResponse } from '../types'
import { toast } from '@/app/components/base/ui/toast'
import { uploadGitHub } from '@/service/plugins'
import { compareVersion, getLatestVersion } from '@/utils/semver'

const normalizeAssetName = (downloadUrl: string) => {
  const parts = downloadUrl.split('/')
  return parts[parts.length - 1]
}

const formatReleases = (releases: any) => {
  return releases.map((release: any) => ({
    tag_name: release.tag,
    assets: release.assets.map((asset: any) => ({
      browser_download_url: asset.downloadUrl,
      name: normalizeAssetName(asset.downloadUrl),
    })),
  }))
}

export const fetchReleases = async (owner: string, repo: string) => {
  try {
    // Fetch releases without authentication from client
    const res = await fetch(`https://ungh.cc/repos/${owner}/${repo}/releases`)
    if (!res.ok)
      throw new Error('Failed to fetch repository releases')
    const data = await res.json()
    return formatReleases(data.releases)
  }
  catch (error) {
    if (error instanceof Error) {
      toast.error(error.message)
    }
    else {
      toast.error('Failed to fetch repository releases')
    }
    return []
  }
}

export const checkForUpdates = (fetchedReleases: GitHubRepoReleaseResponse[], currentVersion: string) => {
  let needUpdate = false
  const toastProps: { type?: 'success' | 'error' | 'info' | 'warning', message: string } = {
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

export const handleUpload = async (
  repoUrl: string,
  selectedVersion: string,
  selectedPackage: string,
  onSuccess?: (GitHubPackage: { manifest: any, unique_identifier: string }) => void,
) => {
  try {
    const response = await uploadGitHub(repoUrl, selectedVersion, selectedPackage)
    const GitHubPackage = {
      manifest: response.manifest,
      unique_identifier: response.unique_identifier,
    }
    if (onSuccess)
      onSuccess(GitHubPackage)
    return GitHubPackage
  }
  catch (error) {
    toast.error('Error uploading package')
    throw error
  }
}
