'use client'
import type { GitHubConnection } from '@/types/github'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal/modal'
import Toast from '@/app/components/base/toast'
import { createGitHubBranch, updateGitHubConnection } from '@/service/github'

type Props = {
  appId?: string
  currentBranch: string
  branches: Array<{ name: string, sha: string, protected: boolean }>
  connection: GitHubConnection | null
  onClose: () => void
  onSuccess?: () => void
}

export const GitHubBranchModal = ({ appId, currentBranch, branches, connection, onClose, onSuccess }: Props) => {
  const { t } = useTranslation('github')
  const { t: tCommon } = useTranslation('common')
  const [isLoading, setIsLoading] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [fromBranch, setFromBranch] = useState(currentBranch)

  const handleSwitchBranch = async (branchName: string) => {
    if (!connection || branchName === currentBranch)
      return

    // eslint-disable-next-line no-alert
    const confirmed = window.confirm(t('branch.switchConfirm'))
    if (!confirmed)
      return

    try {
      setIsLoading(true)
      await updateGitHubConnection({
        connectionId: connection.id,
        payload: { branch: branchName },
      })
      Toast.notify({
        type: 'success',
        message: `${t('branch.switchSuccess')}: ${branchName}`,
      })
      onSuccess?.()
      onClose()
    }
    catch (error: unknown) {
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : t('branch.switchError')
      Toast.notify({
        type: 'error',
        message: errorMessage,
      })
    }
    finally {
      setIsLoading(false)
    }
  }

  const handleCreateBranch = async () => {
    if (!appId || !newBranchName.trim())
      return

    try {
      setIsLoading(true)
      const result = await createGitHubBranch({
        appId,
        branchName: newBranchName.trim(),
        fromBranch,
      })

      if (result.success) {
        Toast.notify({
          type: 'success',
          message: t('branch.createSuccess'),
        })
        setNewBranchName('')
        setShowCreateForm(false)
        onSuccess?.()
      }
    }
    catch (error: unknown) {
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : t('branch.createError')
      Toast.notify({
        type: 'error',
        message: errorMessage,
      })
    }
    finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal
      title={t('branch.title')}
      onClose={onClose}
      onCancel={onClose}
      cancelButtonText={tCommon('operation.cancel')}
      disabled={isLoading}
    >
      <div className="space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="system-sm-medium text-text-primary">
              {t('connection.branch')}
              s
            </label>
            <Button
              variant="primary"
              size="small"
              onClick={() => setShowCreateForm(!showCreateForm)}
              disabled={isLoading}
            >
              {showCreateForm ? tCommon('operation.cancel') : t('branch.create')}
            </Button>
          </div>

          {showCreateForm && (
            <div className="mb-3 space-y-3 rounded-lg border border-components-panel-border bg-components-panel-bg p-3">
              <div>
                <label className="system-sm-medium mb-1.5 block text-text-primary">
                  {t('branch.name')}
                </label>
                <Input
                  value={newBranchName}
                  onChange={e => setNewBranchName(e.target.value)}
                  placeholder={t('branch.namePlaceholder')}
                  disabled={isLoading}
                />
              </div>
              <div>
                <label className="system-sm-medium mb-1.5 block text-text-primary">
                  {t('branch.fromBranch')}
                </label>
                <select
                  value={fromBranch}
                  onChange={e => setFromBranch(e.target.value)}
                  className="border-components-input-border bg-components-input-bg focus:border-components-input-border-focus w-full rounded-lg border px-3 py-2 text-sm text-text-primary focus:outline-none"
                  disabled={isLoading}
                >
                  {branches.map(branch => (
                    <option key={branch.name} value={branch.name}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                variant="primary"
                size="small"
                onClick={handleCreateBranch}
                disabled={isLoading || !newBranchName.trim()}
                className="w-full"
              >
                {t('branch.createNew')}
              </Button>
            </div>
          )}

          <div className="max-h-60 space-y-1 overflow-y-auto">
            {branches.map(branch => (
              <button
                key={branch.name}
                onClick={() => handleSwitchBranch(branch.name)}
                disabled={isLoading || branch.name === currentBranch}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  branch.name === currentBranch
                    ? 'cursor-default border-components-panel-border bg-components-panel-bg text-text-primary'
                    : 'border-components-button-secondary-border bg-components-button-secondary-bg text-components-button-secondary-text hover:bg-components-button-secondary-bg-hover'
                } ${isLoading ? 'cursor-not-allowed opacity-50' : branch.name !== currentBranch ? 'cursor-pointer' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span>{branch.name}</span>
                  {branch.name === currentBranch && (
                    <span className="system-xs-medium text-text-secondary">
                      {t('branch.current')}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
