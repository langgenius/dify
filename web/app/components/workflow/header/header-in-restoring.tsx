import { cn } from '@langgenius/dify-ui/cn'
import { RiHistoryLine } from '@remixicon/react'
import {
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { Button } from '@/app/components/base/ui/button'
import { toast } from '@/app/components/base/ui/toast'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import useTheme from '@/hooks/use-theme'
import { useInvalidAllLastRun } from '@/service/use-workflow'
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
}
const HeaderInRestoring = ({
  onRestoreSettled,
}: HeaderInRestoringProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const workflowStore = useWorkflowStore()
  const userProfile = useAppContextSelector(s => s.userProfile)
  const featuresStore = useFeaturesStore()
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
  const { requestRestore } = useLeaderRestore()
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const canRestore = !!currentVersion?.id && !!configsMap?.flowId && currentVersion.version !== WorkflowVersion.Draft

  const handleCancelRestore = useCallback(() => {
    handleLoadBackupDraft()
    workflowStore.setState({ isRestoring: false })
    setShowWorkflowVersionHistoryPanel(false)
  }, [workflowStore, handleLoadBackupDraft, setShowWorkflowVersionHistoryPanel])

  const handleRestore = useCallback(() => {
    if (!canRestore || !currentVersion)
      return

    setShowWorkflowVersionHistoryPanel(false)
    workflowStore.setState({ isRestoring: false })
    workflowStore.setState({ backupDraft: undefined })

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
  }, [canRestore, currentVersion, setShowWorkflowVersionHistoryPanel, workflowStore, featuresStore, requestRestore, userProfile, handleRefreshWorkflowDraft, deleteAllInspectVars, invalidAllLastRun, t, onRestoreSettled])

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
