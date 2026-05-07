import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { RiHistoryLine } from '@remixicon/react'
import {
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import useTheme from '@/hooks/use-theme'
import { useInvalidAllLastRun, useResetWorkflowVersionHistory, useRestoreWorkflow } from '@/service/use-workflow'
import { FlowType } from '@/types/common'
import {
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
}
const HeaderInRestoring = ({
  onRestoreSettled,
}: HeaderInRestoringProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const workflowStore = useWorkflowStore()
  const userProfile = useAppContextSelector(s => s.userProfile)
  const configsMap = useHooksStore(s => s.configsMap)
  const invalidAllLastRun = useInvalidAllLastRun(configsMap?.flowType, configsMap?.flowId)
  const {
    deleteAllInspectVars,
  } = workflowStore.getState()
  const currentVersion = useStore(s => s.currentVersion)
  const setShowWorkflowVersionHistoryPanel = useStore(s => s.setShowWorkflowVersionHistoryPanel)

  const {
    handleLoadBackupDraft,
  } = useWorkflowRun()
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const { mutateAsync: restoreWorkflow } = useRestoreWorkflow()
  const resetWorkflowVersionHistory = useResetWorkflowVersionHistory()
  const canRestore = !!currentVersion?.id && !!configsMap?.flowId && currentVersion.version !== WorkflowVersion.Draft
  const canEmitCollaborationEvents = configsMap?.flowType === FlowType.appFlow

  const handleCancelRestore = useCallback(() => {
    handleLoadBackupDraft()
    workflowStore.setState({ isRestoring: false })
    setShowWorkflowVersionHistoryPanel(false)
  }, [workflowStore, handleLoadBackupDraft, setShowWorkflowVersionHistoryPanel])

  const restoreVersionUrl = useCallback((versionId: string) => {
    if (!configsMap?.flowId)
      return ''
    if (configsMap.flowType === FlowType.ragPipeline)
      return `/rag/pipelines/${configsMap.flowId}/workflows/${versionId}/restore`
    return `/apps/${configsMap.flowId}/workflows/${versionId}/restore`
  }, [configsMap?.flowId, configsMap?.flowType])

  const emitRestoreIntent = useCallback(async () => {
    if (!currentVersion || !canEmitCollaborationEvents)
      return
    try {
      const { collaborationManager } = await import('../collaboration/core/collaboration-manager')
      collaborationManager.emitRestoreIntent({
        versionId: currentVersion.id,
        versionName: currentVersion.marked_name,
        initiatorUserId: userProfile.id,
        initiatorName: userProfile.name,
      })
    }
    catch (error) {
      console.error('Failed to emit restore intent:', error)
    }
  }, [canEmitCollaborationEvents, currentVersion, userProfile.id, userProfile.name])

  const emitRestoreComplete = useCallback(async (success: boolean, errorMessage?: string) => {
    if (!currentVersion || !canEmitCollaborationEvents)
      return
    try {
      const { collaborationManager } = await import('../collaboration/core/collaboration-manager')
      collaborationManager.emitRestoreComplete({
        versionId: currentVersion.id,
        success,
        ...(errorMessage ? { error: errorMessage } : {}),
      })
    }
    catch (error) {
      console.error('Failed to emit restore complete:', error)
    }
  }, [canEmitCollaborationEvents, currentVersion])

  const emitWorkflowUpdate = useCallback(async () => {
    if (!configsMap?.flowId || !canEmitCollaborationEvents)
      return
    try {
      const { collaborationManager } = await import('../collaboration/core/collaboration-manager')
      collaborationManager.emitWorkflowUpdate(configsMap.flowId)
    }
    catch (error) {
      console.error('Failed to emit workflow update:', error)
    }
  }, [canEmitCollaborationEvents, configsMap?.flowId])

  const handleRestore = useCallback(async () => {
    if (!canRestore || !currentVersion)
      return

    setShowWorkflowVersionHistoryPanel(false)
    await emitRestoreIntent()

    try {
      await restoreWorkflow(restoreVersionUrl(currentVersion.id))
      workflowStore.setState({ isRestoring: false })
      workflowStore.setState({ backupDraft: undefined })
      handleRefreshWorkflowDraft()
      toast.success(t('versionHistory.action.restoreSuccess', { ns: 'workflow' }))
      deleteAllInspectVars()
      invalidAllLastRun()
      await emitRestoreComplete(true)
      await emitWorkflowUpdate()
    }
    catch {
      toast.error(t('versionHistory.action.restoreFailure', { ns: 'workflow' }))
      await emitRestoreComplete(false, 'restore failed')
    }
    finally {
      resetWorkflowVersionHistory()
      onRestoreSettled?.()
    }
  }, [canRestore, currentVersion, setShowWorkflowVersionHistoryPanel, emitRestoreIntent, restoreWorkflow, restoreVersionUrl, workflowStore, handleRefreshWorkflowDraft, t, deleteAllInspectVars, invalidAllLastRun, emitRestoreComplete, emitWorkflowUpdate, resetWorkflowVersionHistory, onRestoreSettled])

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
