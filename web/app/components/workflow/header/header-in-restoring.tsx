import { RiHistoryLine } from '@remixicon/react'
import {
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import useTheme from '@/hooks/use-theme'
import { useInvalidAllLastRun } from '@/service/use-workflow'
import { cn } from '@/utils/classnames'
import Toast from '../../base/toast'
import {
  useNodesSyncDraft,
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
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleCancelRestore = useCallback(() => {
    handleLoadBackupDraft()
    workflowStore.setState({ isRestoring: false })
    setShowWorkflowVersionHistoryPanel(false)
  }, [workflowStore, handleLoadBackupDraft, setShowWorkflowVersionHistoryPanel])

  const handleRestore = useCallback(() => {
    setShowWorkflowVersionHistoryPanel(false)
    workflowStore.setState({ isRestoring: false })
    workflowStore.setState({ backupDraft: undefined })
    handleSyncWorkflowDraft(true, false, {
      onSuccess: () => {
        Toast.notify({
          type: 'success',
          message: t('versionHistory.action.restoreSuccess', { ns: 'workflow' }),
        })
      },
      onError: () => {
        Toast.notify({
          type: 'error',
          message: t('versionHistory.action.restoreFailure', { ns: 'workflow' }),
        })
      },
      onSettled: () => {
        onRestoreSettled?.()
      },
    })
    deleteAllInspectVars()
    invalidAllLastRun()
  }, [setShowWorkflowVersionHistoryPanel, workflowStore, handleSyncWorkflowDraft, deleteAllInspectVars, invalidAllLastRun, t, onRestoreSettled])

  return (
    <>
      <div>
        <RestoringTitle />
      </div>
      <div className=" flex items-center justify-end gap-x-2">
        <Button
          onClick={handleRestore}
          disabled={!currentVersion || currentVersion.version === WorkflowVersion.Draft}
          variant="primary"
          className={cn(
            'rounded-lg border border-transparent',
            theme === 'dark' && 'border-black/5 bg-white/10 backdrop-blur-sm',
          )}
        >
          {t('common.restore', { ns: 'workflow' })}
        </Button>
        <Button
          onClick={handleCancelRestore}
          className={cn(
            'rounded-lg border border-transparent text-components-button-secondary-accent-text',
            theme === 'dark' && 'border-black/5 bg-white/10 backdrop-blur-sm',
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
