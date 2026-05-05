import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { RiHistoryLine } from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import useTheme from '@/hooks/use-theme'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useInvalidAllLastRun, useRestoreWorkflow } from '@/service/use-workflow'
import {
  useLeaderRestore,
  useWorkflowRefreshDraft,
  useWorkflowRun,
} from '../hooks'
import { useHooksStore } from '../hooks-store'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import {
  WorkflowVersion,
} from '../types'
import RestoringTitle from './restoring-title'

export type HeaderInRestoringProps = {
  onRestoreSettled?: () => void
  restoreVersionUrl?: (versionId: string) => string
}
const HeaderInRestoring = ({
  onRestoreSettled,
  restoreVersionUrl,
}: HeaderInRestoringProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const workflowStore = useWorkflowStore()
  const userProfile = useAppContextSelector(s => s.userProfile)
  const featuresStore = useFeaturesStore()
  const configsMap = useHooksStore(s => s.configsMap)
  const invalidAllLastRun = useInvalidAllLastRun(configsMap?.flowType, configsMap?.flowId)
  const { data: isCollaborationEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_collaboration_mode,
  })
  const {
    deleteAllInspectVars,
  } = workflowStore.getState()
  const currentVersion = useStore(s => s.currentVersion)
  const setShowWorkflowVersionHistoryPanel = useStore(s => s.setShowWorkflowVersionHistoryPanel)

  const {
    handleLoadBackupDraft,
  } = useWorkflowRun()
  const { requestRestore } = useLeaderRestore()
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const { mutateAsync: restoreWorkflow } = useRestoreWorkflow()
  const canRestore = !!currentVersion?.id && !!configsMap?.flowId && currentVersion.version !== WorkflowVersion.Draft

  const handleCancelRestore = useCallback(() => {
    handleLoadBackupDraft()
    workflowStore.setState({ isRestoring: false })
    setShowWorkflowVersionHistoryPanel(false)
  }, [workflowStore, handleLoadBackupDraft, setShowWorkflowVersionHistoryPanel])

  const handleRestore = useCallback(async () => {
    if (!canRestore || !currentVersion)
      return

    setShowWorkflowVersionHistoryPanel(false)
    workflowStore.setState({ isRestoring: false })
    workflowStore.setState({ backupDraft: undefined })

    // When collaboration mode is disabled the CRDT layer is never initialised, so
    // setNodes/setEdges are no-ops and refreshGraphSynchronously emits an empty
    // graphImport event that wipes the canvas.  Use the REST API path instead,
    // which is identical to what the context-menu "Restore" option does.
    // NOTE: restoreVersionUrl must always be provided when collaboration is disabled.
    if (!isCollaborationEnabled && restoreVersionUrl) {
      // Non-collaboration path: call the dedicated restore API endpoint, then
      // refresh the draft from the server — same mechanism as context menu restore.
      try {
        await restoreWorkflow(restoreVersionUrl(currentVersion.id))
        handleRefreshWorkflowDraft()
        toast.success(t('versionHistory.action.restoreSuccess', { ns: 'workflow' }))
        deleteAllInspectVars()
        invalidAllLastRun()
      }
      catch {
        toast.error(t('versionHistory.action.restoreFailure', { ns: 'workflow' }))
      }
      finally {
        onRestoreSettled?.()
      }
      return
    }

    // Collaboration path: apply graph locally via CRDT then sync draft.
    const { graph } = currentVersion
    const features = featuresStore?.getState().features
    const environmentVariables = currentVersion.environment_variables || []
    const conversationVariables = currentVersion.conversation_variables || []

    requestRestore({
      versionId: currentVersion.id,
      versionName: currentVersion.marked_name,
      initiatorUserId: userProfile.id,
      initiatorName: userProfile.name,
      graphData: {
        nodes: graph.nodes,
        edges: graph.edges,
        viewport: graph.viewport,
      },
      features,
      environmentVariables,
      conversationVariables,
    }, {
      onSuccess: () => {
        handleRefreshWorkflowDraft()
        toast.success(t('versionHistory.action.restoreSuccess', { ns: 'workflow' }))
        deleteAllInspectVars()
        invalidAllLastRun()
      },
      onError: () => {
        toast.error(t('versionHistory.action.restoreFailure', { ns: 'workflow' }))
      },
      onSettled: () => {
        onRestoreSettled?.()
      },
    })
  }, [canRestore, currentVersion, setShowWorkflowVersionHistoryPanel, workflowStore, isCollaborationEnabled, restoreVersionUrl, restoreWorkflow, handleRefreshWorkflowDraft, featuresStore, requestRestore, userProfile, deleteAllInspectVars, invalidAllLastRun, t, onRestoreSettled])

  return (
    <>
      <div>
        <RestoringTitle />
      </div>
      <div className="flex items-center justify-end gap-x-2">
        <Button
          onClick={handleRestore}
          disabled={!canRestore}
          variant="primary"
          className={cn(
            'rounded-lg border border-transparent',
            theme === 'dark' && 'border-black/5 bg-white/10 backdrop-blur-xs',
          )}
        >
          {t('common.restore', { ns: 'workflow' })}
        </Button>
        <Button
          onClick={handleCancelRestore}
          className={cn(
            'rounded-lg border border-transparent text-components-button-secondary-accent-text',
            theme === 'dark' && 'border-black/5 bg-white/10 backdrop-blur-xs',
          )}
        >
          <div className="flex items-center gap-x-0.5">
            <RiHistoryLine className="h-4 w-4" />
            <span className="px-0.5">{t('common.exitVersions', { ns: 'workflow' })}</span>
          </div>
        </Button>
      </div>
    </>
  )
}

export default HeaderInRestoring
