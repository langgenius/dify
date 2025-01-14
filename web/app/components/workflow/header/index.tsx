import type { FC } from 'react'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { RiApps2AddLine } from '@remixicon/react'
import { useNodes } from 'reactflow'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import {
  BlockEnum,
  InputVarType,
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
import { ToastContext } from '../../base/toast'
import Divider from '../../base/divider'
import RunAndHistory from './run-and-history'
import EditingTitle from './editing-title'
import RunningTitle from './running-title'
import RestoringTitle from './restoring-title'
import ViewHistory from './view-history'
import ChatVariableButton from './chat-variable-button'
import EnvButton from './env-button'
import VersionHistoryModal from './version-history-modal'
import Button from '@/app/components/base/button'
import { useStore as useAppStore } from '@/app/components/app/store'
import { publishWorkflow } from '@/service/workflow'
import { ArrowNarrowLeft } from '@/app/components/base/icons/src/vender/line/arrows'
import { useFeatures } from '@/app/components/base/features/hooks'

const Header: FC = () => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const appDetail = useAppStore(s => s.appDetail)
  const appSidebarExpand = useAppStore(s => s.appSidebarExpand)
  const appID = appDetail?.id
  const isChatMode = useIsChatMode()
  const { nodesReadOnly, getNodesReadOnly } = useNodesReadOnly()
  const { handleNodeSelect } = useNodesInteractions()
  const publishedAt = useStore(s => s.publishedAt)
  const draftUpdatedAt = useStore(s => s.draftUpdatedAt)
  const toolPublished = useStore(s => s.toolPublished)
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
  }, [workflowStore, handleLoadBackupDraft])

  const handleRestore = useCallback(() => {
    workflowStore.setState({ isRestoring: false })
    workflowStore.setState({ backupDraft: undefined })
    handleSyncWorkflowDraft(true)
  }, [handleSyncWorkflowDraft, workflowStore])

  const onPublish = useCallback(async () => {
    if (handleCheckBeforePublish()) {
      const res = await publishWorkflow(`/apps/${appID}/workflows/publish`)

      if (res) {
        notify({ type: 'success', message: t('common.api.actionSuccess') })
        workflowStore.getState().setPublishedAt(res.created_at)
      }
    }
    else {
      throw new Error('Checklist failed')
    }
  }, [appID, handleCheckBeforePublish, notify, t, workflowStore])

  const onStartRestoring = useCallback(() => {
    workflowStore.setState({ isRestoring: true })
    handleBackupDraft()
    // clear right panel
    if (selectedNode)
      handleNodeSelect(selectedNode.id, true)
  }, [handleBackupDraft, workflowStore, handleNodeSelect, selectedNode])

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
      className='absolute top-0 left-0 z-10 flex items-center justify-between w-full px-3 h-14 bg-mask-top2bottom-gray-50-to-transparent'
    >
      <div>
        {
          appSidebarExpand === 'collapse' && (
            <div className='system-xs-regular text-text-tertiary'>{appDetail?.name}</div>
          )
        }
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
            <Divider type='vertical' className='h-3.5 mx-auto' />
            <RunAndHistory />
            <Button className='text-components-button-secondary-text' onClick={handleShowFeatures}>
              <RiApps2AddLine className='w-4 h-4 mr-1 text-components-button-secondary-text' />
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
                onRestore: onStartRestoring,
                onToggle: onPublisherToggle,
                crossAxisOffset: 4,
              }}
            />
          </div>
        )
      }
      {
        viewHistory && (
          <div className='flex items-center space-x-2'>
            <ViewHistory withText />
            <Divider type='vertical' className='h-3.5 mx-auto' />
            <Button
              variant='primary'
              onClick={handleGoBackToEdit}
            >
              <ArrowNarrowLeft className='w-4 h-4 mr-1' />
              {t('workflow.common.goBackToEdit')}
            </Button>
          </div>
        )
      }
      {
        restoring && (
          <div className='flex flex-col mt-auto'>
            <div className='flex items-center justify-end my-4'>
              <Button className='text-components-button-secondary-text' onClick={handleShowFeatures}>
                <RiApps2AddLine className='w-4 h-4 mr-1 text-components-button-secondary-text' />
                {t('workflow.common.features')}
              </Button>
              <div className='mx-2 w-[1px] h-3.5 bg-gray-200'></div>
              <Button
                className='mr-2'
                onClick={handleCancelRestore}
              >
                {t('common.operation.cancel')}
              </Button>
              <Button
                onClick={handleRestore}
                variant='primary'
              >
                {t('workflow.common.restore')}
              </Button>
            </div>
            <VersionHistoryModal />
          </div>
        )
      }
    </div>
  )
}

export default memo(Header)
