import type { FC } from 'react'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { RiApps2AddLine, RiHistoryLine } from '@remixicon/react'
import { useNodes } from 'reactflow'
import { useTranslation } from 'react-i18next'
import { useContext, useContextSelector } from 'use-context-selector'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import {
  BlockEnum,
  InputVarType,
  WorkflowVersion,
} from '../types'
import type { StartNodeType } from '../nodes/start/types'
import {
  useChecklistBeforePublish,
  useIsChatMode,
  useNodesInteractions,
  useNodesReadOnly,
  useNodesSyncDraft,
  useWorkflowMode,
  useWorkflowRun,
} from '../hooks'
import AppPublisher from '../../app/app-publisher'
import Toast, { ToastContext } from '../../base/toast'
import Divider from '../../base/divider'
import RunAndHistory from './run-and-history'
import EditingTitle from './editing-title'
import RunningTitle from './running-title'
import RestoringTitle from './restoring-title'
import ViewHistory from './view-history'
import ChatVariableButton from './chat-variable-button'
import EnvButton from './env-button'
import VersionHistoryButton from './version-history-button'
import Button from '@/app/components/base/button'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ArrowNarrowLeft } from '@/app/components/base/icons/src/vender/line/arrows'
import { useFeatures } from '@/app/components/base/features/hooks'
import { usePublishWorkflow, useResetWorkflowVersionHistory } from '@/service/use-workflow'
import type { PublishWorkflowParams } from '@/types/workflow'
import { fetchAppDetail, fetchAppSSO } from '@/service/apps'
import AppContext from '@/context/app-context'

const Header: FC = () => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const appDetail = useAppStore(s => s.appDetail)
  const setAppDetail = useAppStore(s => s.setAppDetail)
  const systemFeatures = useContextSelector(AppContext, state => state.systemFeatures)
  const appID = appDetail?.id
  const isChatMode = useIsChatMode()
  const { nodesReadOnly, getNodesReadOnly } = useNodesReadOnly()
  const { handleNodeSelect } = useNodesInteractions()
  const publishedAt = useStore(s => s.publishedAt)
  const draftUpdatedAt = useStore(s => s.draftUpdatedAt)
  const toolPublished = useStore(s => s.toolPublished)
  const currentVersion = useStore(s => s.currentVersion)
  const setShowWorkflowVersionHistoryPanel = useStore(s => s.setShowWorkflowVersionHistoryPanel)
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const setShowDebugAndPreviewPanel = useStore(s => s.setShowDebugAndPreviewPanel)
  const nodes = useNodes<StartNodeType>()
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
  const selectedNode = nodes.find(node => node.data.selected)
  const startVariables = startNode?.data.variables
  const fileSettings = useFeatures(s => s.features.file)
  const variables = useMemo(() => {
    const data = startVariables || []
    if (fileSettings?.image?.enabled) {
      return [
        ...data,
        {
          type: InputVarType.files,
          variable: '__image',
          required: false,
          label: 'files',
        },
      ]
    }

    return data
  }, [fileSettings?.image?.enabled, startVariables])

  const {
    handleLoadBackupDraft,
    handleBackupDraft,
  } = useWorkflowRun()
  const { handleCheckBeforePublish } = useChecklistBeforePublish()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { notify } = useContext(ToastContext)
  const {
    normal,
    restoring,
    viewHistory,
  } = useWorkflowMode()

  const handleShowFeatures = useCallback(() => {
    const {
      showFeaturesPanel,
      isRestoring,
      setShowFeaturesPanel,
    } = workflowStore.getState()
    if (getNodesReadOnly() && !isRestoring)
      return
    setShowFeaturesPanel(!showFeaturesPanel)
  }, [workflowStore, getNodesReadOnly])

  const handleCancelRestore = useCallback(() => {
    handleLoadBackupDraft()
    workflowStore.setState({ isRestoring: false })
    setShowWorkflowVersionHistoryPanel(false)
  }, [workflowStore, handleLoadBackupDraft, setShowWorkflowVersionHistoryPanel])

  const resetWorkflowVersionHistory = useResetWorkflowVersionHistory(appDetail!.id)

  const handleRestore = useCallback(() => {
    setShowWorkflowVersionHistoryPanel(false)
    workflowStore.setState({ isRestoring: false })
    workflowStore.setState({ backupDraft: undefined })
    handleSyncWorkflowDraft(true, false, {
      onSuccess: () => {
        Toast.notify({
          type: 'success',
          message: t('workflow.versionHistory.action.restoreSuccess'),
        })
      },
      onError: () => {
        Toast.notify({
          type: 'error',
          message: t('workflow.versionHistory.action.restoreFailure'),
        })
      },
      onSettled: () => {
        resetWorkflowVersionHistory()
      },
    })
  }, [handleSyncWorkflowDraft, workflowStore, setShowWorkflowVersionHistoryPanel, resetWorkflowVersionHistory, t])

  const updateAppDetail = useCallback(async () => {
    try {
      const res = await fetchAppDetail({ url: '/apps', id: appID! })
      if (systemFeatures.enable_web_sso_switch_component) {
        const ssoRes = await fetchAppSSO({ appId: appID! })
        setAppDetail({ ...res, enable_sso: ssoRes.enabled })
      }
      else {
        setAppDetail({ ...res })
      }
    }
    catch (error) {
      console.error(error)
    }
  }, [appID, setAppDetail, systemFeatures.enable_web_sso_switch_component])

  const { mutateAsync: publishWorkflow } = usePublishWorkflow(appID!)

  const onPublish = useCallback(async (params?: PublishWorkflowParams) => {
    if (handleCheckBeforePublish()) {
      const res = await publishWorkflow({
        title: params?.title || '',
        releaseNotes: params?.releaseNotes || '',
      })

      if (res) {
        notify({ type: 'success', message: t('common.api.actionSuccess') })
        updateAppDetail()
        workflowStore.getState().setPublishedAt(res.created_at)
        resetWorkflowVersionHistory()
      }
    }
    else {
      throw new Error('Checklist failed')
    }
  }, [handleCheckBeforePublish, notify, t, workflowStore, publishWorkflow, resetWorkflowVersionHistory, updateAppDetail])

  const onStartRestoring = useCallback(() => {
    workflowStore.setState({ isRestoring: true })
    handleBackupDraft()
    // clear right panel
    if (selectedNode)
      handleNodeSelect(selectedNode.id, true)
    setShowWorkflowVersionHistoryPanel(true)
    setShowEnvPanel(false)
    setShowDebugAndPreviewPanel(false)
  }, [handleBackupDraft, workflowStore, handleNodeSelect, selectedNode,
    setShowWorkflowVersionHistoryPanel, setShowEnvPanel, setShowDebugAndPreviewPanel])

  const onPublisherToggle = useCallback((state: boolean) => {
    if (state)
      handleSyncWorkflowDraft(true)
  }, [handleSyncWorkflowDraft])

  const handleGoBackToEdit = useCallback(() => {
    handleLoadBackupDraft()
    workflowStore.setState({ historyWorkflowData: undefined })
  }, [workflowStore, handleLoadBackupDraft])

  const handleToolConfigureUpdate = useCallback(() => {
    workflowStore.setState({ toolPublished: true })
  }, [workflowStore])

  return (
    <div
      className='absolute left-0 top-0 z-10 flex h-14 w-full items-center justify-between bg-mask-top2bottom-gray-50-to-transparent px-3'
    >
      <div>
        {
          normal && <EditingTitle />
        }
        {
          viewHistory && <RunningTitle />
        }
        {
          restoring && <RestoringTitle />
        }
      </div>
      {
        normal && (
          <div className='flex items-center gap-2'>
            {/* <GlobalVariableButton disabled={nodesReadOnly} /> */}
            {isChatMode && <ChatVariableButton disabled={nodesReadOnly} />}
            <EnvButton disabled={nodesReadOnly} />
            <Divider type='vertical' className='mx-auto h-3.5' />
            <RunAndHistory />
            <Button className='text-components-button-secondary-text' onClick={handleShowFeatures}>
              <RiApps2AddLine className='mr-1 h-4 w-4 text-components-button-secondary-text' />
              {t('workflow.common.features')}
            </Button>
            <AppPublisher
              {...{
                publishedAt,
                draftUpdatedAt,
                disabled: nodesReadOnly,
                toolPublished,
                inputs: variables,
                onRefreshData: handleToolConfigureUpdate,
                onPublish,
                onToggle: onPublisherToggle,
                crossAxisOffset: 4,
              }}
            />
            <VersionHistoryButton onClick={onStartRestoring} />
          </div>
        )
      }
      {
        viewHistory && (
          <div className='flex items-center space-x-2'>
            <ViewHistory withText />
            <Divider type='vertical' className='mx-auto h-3.5' />
            <Button
              variant='primary'
              onClick={handleGoBackToEdit}
            >
              <ArrowNarrowLeft className='mr-1 h-4 w-4' />
              {t('workflow.common.goBackToEdit')}
            </Button>
          </div>
        )
      }
      {
        restoring && (
          <div className='flex items-center justify-end gap-x-2'>
            <Button
              onClick={handleRestore}
              disabled={!currentVersion || currentVersion.version === WorkflowVersion.Draft}
              variant='primary'
            >
              {t('workflow.common.restore')}
            </Button>
            <Button
              className='text-components-button-secondary-accent-text'
              onClick={handleCancelRestore}
            >
              <div className='flex items-center gap-x-0.5'>
                <RiHistoryLine className='h-4 w-4' />
                <span className='px-0.5'>{t('workflow.common.exitVersions')}</span>
              </div>
            </Button>
          </div>
        )
      }
    </div>
  )
}

export default memo(Header)
