import Toast from '@/app/components/base/toast'
import { uploadGitHub } from '@/service/plugins'
import { Octokit } from '@octokit/core'
import { GITHUB_ACCESS_TOKEN } from '@/config'
import { compareVersion, getLatestVersion } from '@/utils/semver'
import type { GitHubRepoReleaseResponse } from '../types'

export const useGitHubReleases = () => {
  const fetchReleases = async (owner: string, repo: string) => {
    try {
      const octokit = new Octokit({
        auth: GITHUB_ACCESS_TOKEN,
      })
      const res = await octokit.request('GET /repos/{owner}/{repo}/releases', {
        owner,
        repo,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })
      if (res.status !== 200) throw new Error('Failed to fetch releases')

      const formattedReleases = res.data.map((release: any) => ({
        tag_name: release.tag_name,
        assets: release.assets.map((asset: any) => ({
          browser_download_url: asset.browser_download_url,
          name: asset.name,
        })),
      }))

      return formattedReleases
    }
    catch (error) {
      Toast.notify({
        type: 'error',
        message: 'Failed to fetch repository releases',
      })
      return []
    }
  }

  const checkForUpdates = (fetchedReleases: GitHubRepoReleaseResponse[], currentVersion: string) => {
    if (fetchedReleases.length === 0) throw new Error('No releases found')
    const versions = fetchedReleases.map(release => release.tag_name)
    const latestVersion = getLatestVersion(versions)
    let res = false
    try {
      res = compareVersion(latestVersion, currentVersion) === 1
    }
    catch {
      throw new Error('Failed to compare versions, please check the version format.')
    }
    return res
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
