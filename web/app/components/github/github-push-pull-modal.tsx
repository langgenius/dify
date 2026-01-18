'use client'
import type { GitHubBranch } from '@/types/github'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal/modal'
import Toast from '@/app/components/base/toast'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { pullWorkflowFromGitHub, pushWorkflowToGitHub } from '@/service/github'

type Props = {
  appId?: string
  action: 'push' | 'pull'
  currentBranch: string
  branches: Array<{ name: string, sha: string, protected: boolean }>
  onClose: () => void
  onSuccess?: () => void
}

export const GitHubPushPullModal = ({ appId, action, currentBranch, branches, onClose, onSuccess }: Props) => {
  const { t } = useTranslation('github')
  const { t: tCommon } = useTranslation('common')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState(currentBranch)
  const [commitMessage, setCommitMessage] = useState('')
  const handleRefreshWorkflowDraft = useHooksStore(s => s.handleRefreshWorkflowDraft)

  const handleSubmit = async () => {
    if (!appId)
      return

    if (action === 'push' && !commitMessage.trim()) {
      Toast.notify({
        type: 'error',
        message: t('push.commitMessagePlaceholder'),
      })
      return
    }

    if (action === 'pull') {
      const confirmed = window.confirm(t('pull.warning'))
      if (!confirmed)
        return
    }

    try {
      setIsLoading(true)

      if (action === 'push') {
        const result = await pushWorkflowToGitHub({
          appId,
          branch: selectedBranch,
          commitMessage: commitMessage.trim() || `Update workflow - ${new Date().toLocaleString()}`,
        })

        if (result.success) {
          Toast.notify({
            type: 'success',
            message: t('push.success'),
          })
          onSuccess?.()
          onClose()
        }
      }
      else {
        const result = await pullWorkflowFromGitHub({
          appId,
          branch: selectedBranch,
        })

        if (result.success) {
          Toast.notify({
            type: 'success',
            message: t('pull.success'),
          })
          // Refresh the workflow to show the pulled changes
          handleRefreshWorkflowDraft()
          onSuccess?.()
          onClose()
        }
      }
    }
    catch (error: any) {
      Toast.notify({
        type: 'error',
        message: error.message || (action === 'push' ? t('push.error') : t('pull.error')),
      })
    }
    finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal
      title={action === 'push' ? t('push.title') : t('pull.title')}
      subTitle={action === 'push' ? t('push.description') : t('pull.description')}
      onClose={onClose}
      onCancel={onClose}
      cancelButtonText={tCommon('operation.cancel')}
      onConfirm={handleSubmit}
      confirmButtonText={action === 'push' ? t('push.button') : t('pull.button')}
      disabled={isLoading}
    >
      <div className="space-y-4">
        <div>
          <label className="system-sm-medium mb-1.5 block text-text-primary">
            {t('connection.branch')}
          </label>
          <select
            value={selectedBranch}
            onChange={e => setSelectedBranch(e.target.value)}
            className="w-full rounded-lg border border-components-input-border bg-components-input-bg px-3 py-2 text-sm text-text-primary focus:border-components-input-border-focus focus:outline-none"
            disabled={isLoading}
          >
            {branches.map(branch => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>

        {action === 'push' && (
          <div>
            <label className="system-sm-medium mb-1.5 block text-text-primary">
              {t('push.commitMessage')}
            </label>
            <Input
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              placeholder={t('push.commitMessagePlaceholder')}
              disabled={isLoading}
            />
          </div>
        )}

        {action === 'pull' && (
          <div className="rounded-lg border border-components-alert-warning-border bg-components-alert-warning-bg p-3">
            <p className="system-sm-regular text-components-alert-warning-text">
              {t('pull.warning')}
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
