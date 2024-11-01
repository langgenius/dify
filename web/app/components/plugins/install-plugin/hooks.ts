import { useState } from 'react'
import Toast from '@/app/components/base/toast'
import { uploadGitHub } from '@/service/plugins'

export const useGitHubReleases = () => {
  const fetchReleases = async (owner: string, repo: string, setReleases: (releases: any) => void) => {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`)
      if (!res.ok) throw new Error('Failed to fetch releases')
      const data = await res.json()

      const formattedReleases = data.map((release: any) => ({
        tag_name: release.tag_name,
        assets: release.assets.map((asset: any) => ({
          browser_download_url: asset.browser_download_url,
          name: asset.name,
        })),
      }))

      setReleases(formattedReleases)
    }
    catch (error) {
      Toast.notify({
        type: 'error',
        message: 'Failed to fetch repository releases',
      })
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
    onSuccess?: (GitHubPackage: { manifest: any; uniqueIdentifier: string }) => void,
  ) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await uploadGitHub(repoUrl, selectedVersion, selectedPackage)
      const GitHubPackage = {
        manifest: response.manifest,
        uniqueIdentifier: response.plugin_unique_identifier,
      }
      if (onSuccess) onSuccess(GitHubPackage)
      return GitHubPackage
    }
    catch (error) {
      setError('Error installing package')
      Toast.notify({
        type: 'error',
        message: 'Error installing package',
      })
    }
    finally {
      setIsLoading(false)
    }
  }

  return { handleUpload, isLoading, error }
}
