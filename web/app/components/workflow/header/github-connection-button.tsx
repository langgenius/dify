'use client'
import { RiGitBranchLine } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Button from '@/app/components/base/button'
import { GitHubConnectionModal } from '@/app/components/github/github-connection-modal'
import { fetchGitHubConnections } from '@/service/github'

const GitHubConnectionButton = () => {
  const { t } = useTranslation('github')
  const appDetail = useAppStore(s => s.appDetail)
  const [showModal, setShowModal] = useState(false)
  const [connectionId, setConnectionId] = useState<string | null>(null)

  // Fetch existing connection for this app
  const { data: connectionsData } = useQuery({
    queryKey: ['github-connections', appDetail?.id],
    queryFn: () => fetchGitHubConnections({ appId: appDetail?.id }),
    enabled: !!appDetail?.id,
  })

  // Check for OAuth state or connection_id in URL (from OAuth callback) and open modal automatically
  const [oauthStateFromUrl, setOauthStateFromUrl] = useState<string | null>(null)

  useEffect(() => {
    if (appDetail?.id) {
      const urlParams = new URLSearchParams(window.location.search)
      const oauthState = urlParams.get('github_oauth_state')
      const oauthConnectionId = urlParams.get('connection_id') || urlParams.get('github_connection_id')

      if (oauthState || oauthConnectionId) {
        // Store oauth_state before cleaning URL
        if (oauthState) {
          setOauthStateFromUrl(oauthState)
        }
        // Open modal - it will handle oauth_state internally
        setShowModal(true)
        // Clean up URL after a short delay to ensure modal reads it first
        setTimeout(() => {
          const newUrl = new URL(window.location.href)
          newUrl.searchParams.delete('github_oauth_state')
          newUrl.searchParams.delete('connection_id')
          newUrl.searchParams.delete('github_connection_id')
          window.history.replaceState({}, '', newUrl.pathname + newUrl.search)
        }, 100)
      }
    }
  }, [appDetail?.id])

  // Set connectionId when connection is found
  useEffect(() => {
    if (connectionsData?.data && connectionsData.data.length > 0) {
      // Only set if we don't already have one from URL
      if (!connectionId) {
        setConnectionId(connectionsData.data[0].id)
      }
    }
    else {
      // Only clear if we didn't get it from URL
      const urlParams = new URLSearchParams(window.location.search)
      const oauthConnectionId = urlParams.get('connection_id') || urlParams.get('github_connection_id')
      if (!oauthConnectionId) {
        setConnectionId(null)
      }
    }
  }, [connectionsData, connectionId])

  const handleClick = () => {
    // Ensure connectionId is set before opening modal
    if (connectionsData?.data && connectionsData.data.length > 0 && !connectionId) {
      setConnectionId(connectionsData.data[0].id)
    }
    setShowModal(true)
  }

  return (
    <>
      <Button
        variant="secondary"
        size="small"
        onClick={handleClick}
        className="flex items-center gap-1.5"
      >
        <RiGitBranchLine className="h-4 w-4" />
        <span className="text-xs">{t('connection.button')}</span>
      </Button>
      {showModal && (
        <GitHubConnectionModal
          appId={appDetail?.id}
          connectionId={connectionId}
          oauthState={oauthStateFromUrl}
          onClose={() => {
            setShowModal(false)
            setOauthStateFromUrl(null)
            // Don't reset connectionId - keep it so we can reload the same connection
          }}
          onSuccess={(connection) => {
            setConnectionId(connection?.id || null)
            setOauthStateFromUrl(null)
            // Query will auto-refresh via invalidateQueries in the modal
          }}
        />
      )}
    </>
  )
}

export default GitHubConnectionButton
