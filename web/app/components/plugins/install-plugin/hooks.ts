import { useState } from 'react'
import Toast from '@/app/components/base/toast'
import { uploadGitHub } from '@/service/plugins'
import { Octokit } from '@octokit/core'
import { GITHUB_ACCESS_TOKEN } from '@/config'

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

  return { fetchReleases }
}

export const useGitHubUpload = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleUpload = async (
    repoUrl: string,
    selectedVersion: string,
    selectedPackage: string,
    onSuccess?: (GitHubPackage: { manifest: any; unique_identifier: string }) => void,
  ) => {
    setIsLoading(true)
    setError(null)

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
      setError('Error uploading package')
      Toast.notify({
        type: 'error',
        message: 'Error uploading package',
      })
    }
    finally {
      setIsLoading(false)
    }
  }

  return { handleUpload, isLoading, error }
}
