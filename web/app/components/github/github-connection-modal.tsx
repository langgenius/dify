'use client'
import type { GitHubConnection, GitHubConnectionCreatePayload, GitHubRepository } from '@/types/github'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal/modal'
import Toast from '@/app/components/base/toast'
import {
  createGitHubConnection,
  deleteGitHubConnection,
  fetchGitHubConnections,
  fetchGitHubRepositories,
  fetchGitHubRepositoriesFromOAuth,
  getGitHubOAuthUrl,
  updateGitHubConnection,
} from '@/service/github'

type Props = {
  appId?: string
  connectionId?: string | null
  oauthState?: string | null
  onClose: () => void
  onSuccess?: (connection: GitHubConnection) => void
}

export const GitHubConnectionModal = ({ appId, connectionId, oauthState: oauthStateProp, onClose, onSuccess }: Props) => {
  const { t } = useTranslation('github')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState(false)
  const [connection, setConnection] = useState<GitHubConnection | null>(null)
  const [allConnections, setAllConnections] = useState<GitHubConnection[]>([])
  const [repositories, setRepositories] = useState<GitHubRepository[]>([])
  const [selectedRepo, setSelectedRepo] = useState<{ owner: string, name: string } | null>(null)
  const [showRepoSelector, setShowRepoSelector] = useState(false)

  // Check if we have OAuth state from OAuth callback (new flow - no incomplete connection)
  const [oauthState, setOauthState] = useState<string | null>(oauthStateProp || null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [connectionToDelete, setConnectionToDelete] = useState<string | null>(null)
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false)
  const oauthStateInitialized = useRef(false)
  const showRepoSelectorInitialized = useRef(false)

  const loadRepositories = async (connId?: string) => {
    try {
      setIsLoading(true)

      if (oauthState && !connId) {
        // Fetch repositories using OAuth token from Redis
        if (!oauthState) {
          Toast.notify({
            type: 'error',
            message: t('connection.oauthRequired'),
          })
          return
        }
        try {
          const response = await fetchGitHubRepositoriesFromOAuth({ oauthState })
          setRepositories(response.data)
        }
        catch (error: unknown) {
          const errorMessage = error && typeof error === 'object' && 'message' in error
            ? String(error.message)
            : t('connection.loadReposError')
          Toast.notify({
            type: 'error',
            message: errorMessage,
          })
          // If OAuth token expired or endpoint not found, clear oauthState
          if (errorMessage.includes('expired') || errorMessage.includes('not found') || errorMessage.includes('Failed to fetch')) {
            setOauthState(null)
            setShowRepoSelector(false)
          }
          throw error
        }
      }
      else if (connId) {
        // Fetch repositories using existing connection
        const response = await fetchGitHubRepositories({ connectionId: connId })
        setRepositories(response.data)
      }
    }
    catch (error) {
      Toast.notify({
        type: 'error',
        message: error instanceof Error ? error.message : t('connection.loadReposError'),
      })
    }
    finally {
      setIsLoading(false)
    }
  }

  const loadConnection = async (id: string) => {
    try {
      setIsLoading(true)
      const response = await fetchGitHubConnections({ appId })
      setAllConnections(response.data)
      const conn = response.data.find(c => c.id === id)
      if (conn) {
        setConnection(conn)
        setSelectedRepo({
          owner: conn.repository_owner,
          name: conn.repository_name,
        })
        if (conn.repository_name) {
          setShowRepoSelector(false)
        }
        else {
          setShowRepoSelector(true)
          loadRepositories(id)
        }
      }
    }
    catch (error) {
      Toast.notify({
        type: 'error',
        message: error instanceof Error ? error.message : t('connection.loadError'),
      })
    }
    finally {
      setIsLoading(false)
    }
  }

  const checkPendingConnections = async () => {
    try {
      setIsLoading(true)
      const response = await fetchGitHubConnections({ appId })
      setAllConnections(response.data)

      if (response.data.length > 0) {
        // Find connection without repository (pending OAuth) or use first existing connection
        const pending = response.data.find(c => !c.repository_name)
        const existing = pending || response.data[0]

        if (existing) {
          setConnection(existing)
          setSelectedRepo({
            owner: existing.repository_owner,
            name: existing.repository_name,
          })
          if (existing.repository_name) {
            setShowRepoSelector(false)
          }
          else {
            setShowRepoSelector(true)
            // Try to load repositories, but don't fail if it errors
            try {
              await loadRepositories(existing.id)
            }
            catch {
              // Ignore repository loading errors for incomplete connections
            }
          }
        }
      }
    }
    catch (error) {
      Toast.notify({
        type: 'error',
        message: error instanceof Error ? error.message : t('connection.loadError'),
      })
    }
    finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // Use prop first, then check URL as fallback
    const urlParams = new URLSearchParams(window.location.search)
    const oauthStateParam = oauthStateProp || urlParams.get('github_oauth_state')
    const oauthConnectionId = urlParams.get('connection_id') || urlParams.get('github_connection_id')

    if (oauthStateParam && !oauthStateInitialized.current) {
      // New flow: OAuth token is stored in Redis, show repository selector
      oauthStateInitialized.current = true
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setOauthState(oauthStateParam)
    }
    if (oauthStateParam && !showRepoSelectorInitialized.current) {
      showRepoSelectorInitialized.current = true
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setShowRepoSelector(true)
    }
    else if (oauthConnectionId) {
      // Old flow: Load existing incomplete connection
      loadConnection(oauthConnectionId)
      // Clean up URL
      const newUrl = new URL(window.location.href)
      newUrl.searchParams.delete('connection_id')
      newUrl.searchParams.delete('github_connection_id')
      window.history.replaceState({}, '', newUrl.pathname + newUrl.search)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthStateProp, appId])

  // Load repositories when oauthState is set and repo selector is shown
  useEffect(() => {
    if (oauthState && showRepoSelector && !connection) {
      // Add a small delay to ensure oauthState is set
      const timer = setTimeout(() => {
        loadRepositories()
      }, 100)
      return () => clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthState, showRepoSelector, connection])

  // Load existing connection
  useEffect(() => {
    if (connectionId) {
      loadConnection(connectionId)
    }
    else if (appId) {
      // Check for pending connections
      checkPendingConnections()
    }
  }, [connectionId, appId])

  const handleConnect = async () => {
    // Before going to OAuth, check if there's already an incomplete connection we can reuse
    try {
      const response = await fetchGitHubConnections({ appId })
      const incompleteConnection = response.data.find(c => !c.repository_name)

      if (incompleteConnection) {
        // Reuse existing incomplete connection instead of creating a new one
        setConnection(incompleteConnection)
        setAllConnections(response.data)
        setSelectedRepo({
          owner: incompleteConnection.repository_owner,
          name: incompleteConnection.repository_name,
        })
        setShowRepoSelector(true)
        // Try to load repositories
        try {
          await loadRepositories(incompleteConnection.id)
        }
        catch {
          // Ignore errors - repositories might not be loadable for incomplete connections
        }
        return
      }
    }
    catch (error) {
      // If check fails, proceed with OAuth
      console.warn('Failed to check for existing connections:', error)
    }

    // No existing incomplete connection, proceed with OAuth
    const oauthUrl = getGitHubOAuthUrl({ appId })
    window.location.href = oauthUrl
  }

  const handleSelectRepository = (repo: GitHubRepository) => {
    setSelectedRepo({
      owner: repo.full_name.split('/')[0],
      name: repo.name,
    })
  }

  const handleSave = async () => {
    if (!selectedRepo) {
      Toast.notify({
        type: 'error',
        message: t('connection.selectRepoRequired'),
      })
      return
    }

    // If we have oauthState but no connection, we need to create a new connection
    if (!connection && !oauthState) {
      // Need to connect first
      handleConnect()
      return
    }

    try {
      setIsLoading(true)

      if (connection && connection.repository_name) {
        // Update existing connection
        const payload = {
          repository_owner: selectedRepo.owner,
          repository_name: selectedRepo.name,
          branch: 'main', // Default to main, users can change it in push/pull operations
        }
        const response = await updateGitHubConnection({
          connectionId: connection.id,
          payload,
        })
        Toast.notify({
          type: 'success',
          message: t('connection.updateSuccess'),
        })
        queryClient.invalidateQueries({ queryKey: ['github-connections', appId] })
        // Reload all connections
        const updatedResponse = await fetchGitHubConnections({ appId })
        setAllConnections(updatedResponse.data)
        // Update local connection state and hide repo selector
        setConnection(response.data)
        setSelectedRepo({
          owner: response.data.repository_owner,
          name: response.data.repository_name,
        })
        setShowRepoSelector(false)
        setOauthState(null)
        onSuccess?.(response.data)
        onClose()
      }
      else {
        // Create new connection (after OAuth - using oauth_state)
        if (!oauthState) {
          Toast.notify({
            type: 'error',
            message: t('connection.oauthRequired'),
          })
          return
        }

        const payload: GitHubConnectionCreatePayload = {
          app_id: appId || null,
          repository_owner: selectedRepo.owner,
          repository_name: selectedRepo.name,
          branch: 'main', // Default to main, users can change it in push/pull operations
          oauth_state: oauthState, // Pass OAuth state to retrieve token from Redis
        }
        const response = await createGitHubConnection(payload)
        Toast.notify({
          type: 'success',
          message: t('connection.createSuccess'),
        })
        queryClient.invalidateQueries({ queryKey: ['github-connections', appId] })
        // Reload all connections
        const updatedResponse = await fetchGitHubConnections({ appId })
        setAllConnections(updatedResponse.data)
        // Update local connection state and hide repo selector
        setConnection(response.data)
        setSelectedRepo({
          owner: response.data.repository_owner,
          name: response.data.repository_name,
        })
        setShowRepoSelector(false)
        setOauthState(null)
        onSuccess?.(response.data)
        onClose()
      }
    }
    catch (error) {
      Toast.notify({
        type: 'error',
        message: error instanceof Error ? error.message : t('connection.saveError'),
      })
    }
    finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async (connectionIdToDelete?: string) => {
    // Try to get connection ID from multiple sources
    let connId = connectionIdToDelete || connection?.id

    // If still no ID, try to get it from allConnections
    if (!connId && allConnections.length > 0) {
      connId = allConnections[0].id
    }

    if (!connId) {
      Toast.notify({
        type: 'error',
        message: `${t('connection.deleteError')}: No connection ID found`,
      })
      return
    }

    setConnectionToDelete(connId)
    setShowDeleteConfirm(true)
  }

  const confirmDelete = async () => {
    if (!connectionToDelete) {
      return
    }

    const connId = connectionToDelete
    setShowDeleteConfirm(false)
    setConnectionToDelete(null)

    try {
      setIsLoading(true)
      await deleteGitHubConnection({ connectionId: connId })
      Toast.notify({
        type: 'success',
        message: t('connection.deleteSuccess'),
      })
      queryClient.invalidateQueries({ queryKey: ['github', 'connections', appId] })

      // Reload connections to refresh the list
      const response = await fetchGitHubConnections({ appId })
      setAllConnections(response.data)

      // If deleting current connection, reset state
      if (connId === connection?.id || response.data.length === 0) {
        if (response.data.length > 0) {
          const existing = response.data.find(c => !c.repository_name) || response.data[0]
          if (existing) {
            setConnection(existing)
            setSelectedRepo({
              owner: existing.repository_owner,
              name: existing.repository_name,
            })
            // Always show repo selector for incomplete connections
            setShowRepoSelector(!existing.repository_name)
            // If incomplete, try to load repositories
            if (!existing.repository_name) {
              try {
                await loadRepositories(existing.id)
              }
              catch {
                // Ignore errors
              }
            }
          }
          else {
            setConnection(null)
            setSelectedRepo(null)
            setShowRepoSelector(false)
            onClose()
          }
        }
        else {
          // No connections left, close modal
          setConnection(null)
          setSelectedRepo(null)
          setShowRepoSelector(false)
          onClose()
        }
      }
      else {
        // Keep current connection, just refresh the list
        if (response.data.length > 0) {
          const current = response.data.find(c => c.id === connection?.id)
          if (current) {
            setConnection(current)
          }
        }
      }
    }
    catch (error: unknown) {
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : t('connection.deleteError')
      Toast.notify({
        type: 'error',
        message: errorMessage,
      })
    }
    finally {
      setIsLoading(false)
    }
  }

  const handleDeleteAll = async () => {
    // Use allConnections if available, otherwise use current connection
    const connectionsToDelete = allConnections.length > 0 ? allConnections : (connection ? [connection] : [])

    if (connectionsToDelete.length === 0) {
      Toast.notify({
        type: 'error',
        message: `${t('connection.deleteAllError')}: No connections found`,
      })
      return
    }

    setShowDeleteAllConfirm(true)
  }

  const confirmDeleteAll = async () => {
    const connectionsToDelete = allConnections.length > 0 ? allConnections : (connection ? [connection] : [])
    const count = connectionsToDelete.length
    setShowDeleteAllConfirm(false)

    try {
      setIsLoading(true)
      let successCount = 0

      // Delete all connections sequentially
      for (const conn of connectionsToDelete) {
        try {
          await deleteGitHubConnection({ connectionId: conn.id })
          successCount++
        }
        catch {
          // Ignore individual errors, track success count
        }
      }

      // Refresh connections
      queryClient.invalidateQueries({ queryKey: ['github', 'connections', appId] })
      const response = await fetchGitHubConnections({ appId })
      setAllConnections(response.data)

      // Reset state
      setConnection(null)
      setSelectedRepo(null)
      setShowRepoSelector(false)

      // Show result
      if (successCount === count) {
        Toast.notify({
          type: 'success',
          message: t('connection.deleteAllSuccess', { count: successCount }),
        })
        onClose()
      }
      else if (successCount > 0) {
        Toast.notify({
          type: 'warning',
          message: t('connection.deleteAllPartial', { success: successCount, total: count }),
        })
      }
      else {
        Toast.notify({
          type: 'error',
          message: t('connection.deleteAllError'),
        })
      }
    }
    catch (error: unknown) {
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : t('connection.deleteAllError')
      Toast.notify({
        type: 'error',
        message: errorMessage,
      })
    }
    finally {
      setIsLoading(false)
    }
  }

  const title = connectionId
    ? t('connection.editTitle')
    : connection
      ? t('connection.completeTitle')
      : t('connection.connectTitle')

  const showDeleteConfirmModal = showDeleteConfirm && connectionToDelete
  const showDeleteAllConfirmModal = showDeleteAllConfirm

  return (
    <>
      {showDeleteConfirmModal && (
        <Modal
          title={t('connection.deleteConfirm')}
          onClose={() => {
            setShowDeleteConfirm(false)
            setConnectionToDelete(null)
          }}
          onCancel={() => {
            setShowDeleteConfirm(false)
            setConnectionToDelete(null)
          }}
          onConfirm={confirmDelete}
          confirmButtonText={tCommon('operation.confirm')}
          cancelButtonText={tCommon('operation.cancel')}
          disabled={isLoading}
          size="sm"
        >
          <p className="text-sm text-text-secondary">
            {t('connection.deleteConfirmMessage')}
          </p>
        </Modal>
      )}
      {showDeleteAllConfirmModal && (
        <Modal
          title={t('connection.deleteAllConfirm', { count: allConnections.length })}
          onClose={() => setShowDeleteAllConfirm(false)}
          onCancel={() => setShowDeleteAllConfirm(false)}
          onConfirm={confirmDeleteAll}
          confirmButtonText={tCommon('operation.confirm')}
          cancelButtonText={tCommon('operation.cancel')}
          disabled={isLoading}
          size="sm"
        >
          <p className="text-sm text-text-secondary">
            {t('connection.deleteAllConfirmMessage', { count: allConnections.length })}
          </p>
        </Modal>
      )}
      <Modal
        title={title}
        onClose={onClose}
        onCancel={onClose}
        onConfirm={handleSave}
        confirmButtonText={connection ? t('connection.save') : t('connection.connect')}
        cancelButtonText={tCommon('operation.cancel')}
        disabled={isLoading}
        size="md"
      >
        <div className="space-y-4">
          {/* Always show delete button at the top if there are any connections */}
          {(connection || allConnections.length > 0) && (
            <div className="bg-components-alert-warning-bg border-components-alert-warning-border rounded-lg border p-3">
              <div className="mb-2 text-sm text-text-primary">
                {allConnections.length > 1
                  ? t('connection.multipleConnectionsWarning', { count: allConnections.length })
                  : connection && !connection.repository_name
                    ? t('connection.incompleteConnection')
                    : t('connection.deleteAllDescription')}
              </div>
              <Button
                variant="secondary"
                size="small"
                destructive
                onClick={() => {
                  const connToDelete = connection || allConnections[0]
                  if (connToDelete?.id) {
                    handleDelete(connToDelete.id)
                  }
                  else if (allConnections.length > 0) {
                    handleDeleteAll()
                  }
                }}
                disabled={isLoading || (!connection && allConnections.length === 0)}
                className="w-full"
              >
                {allConnections.length > 1
                  ? `${t('connection.deleteAll')} (${allConnections.length})`
                  : t('connection.disconnect')}
              </Button>
            </div>
          )}

          {!connection && !oauthState
            ? (
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary">
                    {t('connection.connectDescription')}
                  </p>
                  <Button
                    variant="primary"
                    onClick={handleConnect}
                    disabled={isLoading}
                  >
                    {t('connection.connectToGitHub')}
                  </Button>
                </div>
              )
            : showRepoSelector || oauthState
              ? (
                  <div className="space-y-4">
                    {/* Repository selector - delete button already shown at top */}
                    {oauthState && !connection && (
                      <div className="bg-components-alert-info-bg border-components-alert-info-border rounded-lg border p-3">
                        <div className="text-sm text-text-primary">
                          {t('connection.oauthComplete')}
                        </div>
                      </div>
                    )}
                    <p className="text-sm text-text-secondary">
                      {t('connection.selectRepoDescription')}
                    </p>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-text-primary">
                        {t('connection.repository')}
                      </label>
                      <div className="max-h-60 overflow-y-auto rounded-lg border border-components-panel-border">
                        {repositories.length === 0
                          ? (
                              <div className="p-4 text-center text-sm text-text-tertiary">
                                {isLoading ? tCommon('loading') : t('connection.noRepositories')}
                              </div>
                            )
                          : (
                              repositories.map((repo) => {
                                const isSelected = selectedRepo?.name === repo.name && selectedRepo?.owner === repo.full_name.split('/')[0]
                                return (
                                  <div
                                    key={repo.id}
                                    className={`cursor-pointer border-b border-components-panel-border p-3 transition-colors last:border-b-0 ${
                                      isSelected
                                        ? 'bg-components-panel-active border-l-4 border-l-components-button-primary-border'
                                        : 'hover:bg-components-panel-hover'
                                    }`}
                                    onClick={() => handleSelectRepository(repo)}
                                  >
                                    <div className="flex items-center gap-2">
                                      <div className={`h-2 w-2 rounded-full ${
                                        isSelected ? 'bg-components-button-primary-border' : 'bg-transparent'
                                      }`}
                                      />
                                      <div className="flex-1">
                                        <div className={`font-medium ${
                                          isSelected ? 'text-components-button-primary-text' : 'text-text-primary'
                                        }`}
                                        >
                                          {repo.full_name}
                                        </div>
                                        {repo.description && (
                                          <div className="mt-1 text-sm text-text-tertiary">{repo.description}</div>
                                        )}
                                      </div>
                                      {isSelected && (
                                        <div className="text-components-button-primary-text">
                                          ✓
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )
                              })
                            )}
                      </div>
                      {selectedRepo && (
                        <div className="bg-components-panel-active mt-2 rounded-lg border border-components-panel-border p-2">
                          <div className="text-sm text-text-secondary">
                            {t('connection.selected')}
                            :
                            <span className="font-medium text-text-primary">
                              {selectedRepo.owner}
                              /
                              {selectedRepo.name}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-text-tertiary">
                            {t('connection.branchNote')}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              : connection
                ? (
                    <div className="space-y-4">
                      {connection.repository_name
                        ? (
                            <>
                              <div className="bg-components-panel-active rounded-lg p-4">
                                <div className="mb-2 text-sm text-text-secondary">
                                  {t('connection.connectedTo')}
                                </div>
                                <div className="font-medium text-text-primary">
                                  {connection.repository_full_name}
                                </div>
                                <div className="mt-1 text-sm text-text-tertiary">
                                  {t('connection.branch')}
                                  :
                                  {connection.branch}
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                  // Pre-select current repository
                                    setSelectedRepo({
                                      owner: connection.repository_owner,
                                      name: connection.repository_name,
                                    })
                                    setShowRepoSelector(true)
                                    loadRepositories(connection.id)
                                  }}
                                  disabled={isLoading}
                                >
                                  {t('connection.changeRepository')}
                                </Button>
                                <Button
                                  variant="secondary"
                                  destructive
                                  onClick={() => handleDelete(connection.id)}
                                  disabled={isLoading}
                                >
                                  {t('connection.disconnect')}
                                </Button>
                              </div>
                            </>
                          )
                        : (
                          // Incomplete connection - automatically show repository selector
                          // The delete button is already shown at the top
                            <div className="text-sm text-text-secondary">
                              {t('connection.selectRepoDescription')}
                            </div>
                          )}
                    </div>
                  )
                : null}
        </div>
      </Modal>
    </>
  )
}
