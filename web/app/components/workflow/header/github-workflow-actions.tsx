'use client'
import { RiGitBranchLine, RiGitPullRequestLine, RiUploadCloud2Line } from '@remixicon/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Button from '@/app/components/base/button'
import { useToastContext } from '@/app/components/base/toast'
import { GitHubBranchModal } from '@/app/components/github/github-branch-modal'
import { GitHubPushPullModal } from '@/app/components/github/github-push-pull-modal'
import { fetchGitHubBranchesByApp, fetchGitHubConnections, pullWorkflowFromGitHub, pushWorkflowToGitHub } from '@/service/github'

const GitHubWorkflowActions = () => {
  const { t } = useTranslation('github')
  const { notify } = useToastContext()
  const appDetail = useAppStore(s => s.appDetail)
  const queryClient = useQueryClient()
  const [showBranchModal, setShowBranchModal] = useState(false)
  const [showPushPullModal, setShowPushPullModal] = useState(false)
  const [pushPullAction, setPushPullAction] = useState<'push' | 'pull' | null>(null)

  // Fetch GitHub connection
  const { data: connectionsData } = useQuery({
    queryKey: ['github-connections', appDetail?.id],
    queryFn: () => fetchGitHubConnections({ appId: appDetail?.id }),
    enabled: !!appDetail?.id,
  })

  const connection = connectionsData?.data?.[0]
  const hasConnection = !!connection
  const hasConfiguredRepository = !!connection?.repository_name

  // Fetch branches only if repository is configured
  const { data: branchesData } = useQuery({
    queryKey: ['github-branches', appDetail?.id],
    queryFn: () => fetchGitHubBranchesByApp({ appId: appDetail?.id! }),
    enabled: !!appDetail?.id && hasConnection && hasConfiguredRepository,
    retry: false, // Don't retry if repository is not configured
  })

  const currentBranch = connection?.branch || 'main'
  const branches = branchesData?.data || []

  const handlePush = async () => {
    if (!appDetail?.id)
      return

    try {
      const result = await pushWorkflowToGitHub({
        appId: appDetail.id,
        branch: currentBranch,
        commitMessage: `Update workflow - ${new Date().toLocaleString()}`,
      })

      if (result.success) {
        notify({ type: 'success', message: t('push.success') })
        queryClient.invalidateQueries({ queryKey: ['github-workflows-commits', appDetail.id] })
      }
    }
    catch (error: any) {
      notify({ type: 'error', message: error.message || t('push.error') })
    }
  }

  const handlePull = async () => {
    if (!appDetail?.id)
      return

    try {
      const result = await pullWorkflowFromGitHub({
        appId: appDetail.id,
        branch: currentBranch,
      })

      if (result.success) {
        notify({ type: 'success', message: t('pull.success') })
        // Invalidate workflow cache to refresh UI
        queryClient.invalidateQueries({ queryKey: ['workflow', appDetail.id] })
      }
    }
    catch (error: any) {
      notify({ type: 'error', message: error.message || t('pull.error') })
    }
  }

  // Don't show actions if no connection or repository is not configured
  if (!hasConnection || !hasConfiguredRepository) {
    return null
  }

  return (
    <>
      <div className="flex items-center gap-1 rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-1 shadow-xs">
        <Button
          variant="ghost"
          size="small"
          onClick={() => {
            setPushPullAction('push')
            setShowPushPullModal(true)
          }}
          className="flex items-center gap-1 px-2"
        >
          <RiUploadCloud2Line className="h-3.5 w-3.5" />
          <span className="text-xs">{t('push.button')}</span>
        </Button>
        <div className="h-3.5 w-[1px] bg-divider-regular" />
        <Button
          variant="ghost"
          size="small"
          onClick={() => {
            setPushPullAction('pull')
            setShowPushPullModal(true)
          }}
          className="flex items-center gap-1 px-2"
        >
          <RiGitPullRequestLine className="h-3.5 w-3.5" />
          <span className="text-xs">{t('pull.button')}</span>
        </Button>
        <div className="h-3.5 w-[1px] bg-divider-regular" />
        <Button
          variant="ghost"
          size="small"
          onClick={() => setShowBranchModal(true)}
          className="flex items-center gap-1 px-2"
        >
          <RiGitBranchLine className="h-3.5 w-3.5" />
          <span className="text-xs">{currentBranch}</span>
        </Button>
      </div>

      {showBranchModal && (
        <GitHubBranchModal
          appId={appDetail?.id}
          currentBranch={currentBranch}
          branches={branches}
          connection={connection}
          onClose={() => setShowBranchModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['github-branches', appDetail?.id] })
            queryClient.invalidateQueries({ queryKey: ['github-connections', appDetail?.id] })
            setShowBranchModal(false)
          }}
        />
      )}

      {showPushPullModal && pushPullAction && (
        <GitHubPushPullModal
          appId={appDetail?.id}
          action={pushPullAction}
          currentBranch={currentBranch}
          branches={branches}
          onClose={() => {
            setShowPushPullModal(false)
            setPushPullAction(null)
          }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['github-workflows-commits', appDetail?.id] })
            queryClient.invalidateQueries({ queryKey: ['workflow', appDetail?.id] })
            setShowPushPullModal(false)
            setPushPullAction(null)
          }}
        />
      )}
    </>
  )
}

export default GitHubWorkflowActions
