import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useEdges, useNodes, useStore as useReactflowStore } from 'reactflow'
import { RiApps2AddLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import {
  useChecklist,
  useChecklistBeforePublish,
  useNodesReadOnly,
  useNodesSyncDraft,
  // useWorkflowRunValidation,
} from '@/app/components/workflow/hooks'
import Button from '@/app/components/base/button'
import AppPublisher from '@/app/components/app/app-publisher'
import { useFeatures } from '@/app/components/base/features/hooks'
import type {
  CommonEdgeType,
  CommonNodeType,
} from '@/app/components/workflow/types'
import {
  BlockEnum,
  InputVarType,
} from '@/app/components/workflow/types'
import { useToastContext } from '@/app/components/base/toast'
import { useInvalidateAppWorkflow, usePublishWorkflow, useResetWorkflowVersionHistory } from '@/service/use-workflow'
import { useInvalidateAppTriggers } from '@/service/use-tools'
import type { PublishWorkflowParams } from '@/types/workflow'
import { fetchAppDetail } from '@/service/apps'
import { useStore as useAppStore } from '@/app/components/app/store'
import useTheme from '@/hooks/use-theme'
import cn from '@/utils/classnames'
import { useIsChatMode } from '../../hooks'

const FeaturesTrigger = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const isChatMode = useIsChatMode()
  const workflowStore = useWorkflowStore()
  const appDetail = useAppStore(s => s.appDetail)
  const appID = appDetail?.id
  const setAppDetail = useAppStore(s => s.setAppDetail)
  const { nodesReadOnly, getNodesReadOnly } = useNodesReadOnly()
  const publishedAt = useStore(s => s.publishedAt)
  const draftUpdatedAt = useStore(s => s.draftUpdatedAt)
  const toolPublished = useStore(s => s.toolPublished)
  const lastPublishedHasUserInput = useStore(s => s.lastPublishedHasUserInput)
  const startVariables = useReactflowStore(
    s => s.getNodes().find(node => node.data.type === BlockEnum.Start)?.data.variables,
  )
  const nodes = useNodes<CommonNodeType>()
  const edges = useEdges<CommonEdgeType>()
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

  const { handleCheckBeforePublish } = useChecklistBeforePublish()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { notify } = useToastContext()
  const startNodeIds = useMemo(
    () => nodes.filter(node => node.data.type === BlockEnum.Start).map(node => node.id),
    [nodes],
  )
  const hasUserInputNode = useMemo(() => {
    if (!startNodeIds.length)
      return false
    return edges.some(edge => startNodeIds.includes(edge.source))
  }, [edges, startNodeIds])

  const resetWorkflowVersionHistory = useResetWorkflowVersionHistory()
  const invalidateAppTriggers = useInvalidateAppTriggers()

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

  const updateAppDetail = useCallback(async () => {
    try {
      const res = await fetchAppDetail({ url: '/apps', id: appID! })
      setAppDetail({ ...res })
    }
    catch (error) {
      console.error(error)
    }
  }, [appID, setAppDetail])

  const { mutateAsync: publishWorkflow } = usePublishWorkflow()
  // const { validateBeforeRun } = useWorkflowRunValidation()
  const needWarningNodes = useChecklist(nodes, edges)

  const updatePublishedWorkflow = useInvalidateAppWorkflow()
  const onPublish = useCallback(async (params?: PublishWorkflowParams) => {
    // First check if there are any items in the checklist
    // if (!validateBeforeRun())
    //   throw new Error('Checklist has unresolved items')

    if (needWarningNodes.length > 0) {
      notify({ type: 'error', message: t('workflow.panel.checklistTip') })
      throw new Error('Checklist has unresolved items')
    }

    // Then perform the detailed validation
    if (await handleCheckBeforePublish()) {
      const res = await publishWorkflow({
        url: `/apps/${appID}/workflows/publish`,
        title: params?.title || '',
        releaseNotes: params?.releaseNotes || '',
      })

      if (res) {
        notify({ type: 'success', message: t('common.api.actionSuccess') })
        updatePublishedWorkflow(appID!)
        updateAppDetail()
        invalidateAppTriggers(appID!)
        workflowStore.getState().setPublishedAt(res.created_at)
        workflowStore.getState().setLastPublishedHasUserInput(hasUserInputNode)
        resetWorkflowVersionHistory()
      }
    }
    else {
      throw new Error('Checklist failed')
    }
  }, [needWarningNodes, handleCheckBeforePublish, publishWorkflow, notify, appID, t, updatePublishedWorkflow, updateAppDetail, workflowStore, resetWorkflowVersionHistory, invalidateAppTriggers])

  const onPublisherToggle = useCallback((state: boolean) => {
    if (state)
      handleSyncWorkflowDraft(true)
  }, [handleSyncWorkflowDraft])

  const handleToolConfigureUpdate = useCallback(() => {
    workflowStore.setState({ toolPublished: true })
  }, [workflowStore])

  return (
    <>
      {/* Feature button is only visible in chatflow mode (advanced-chat) */}
      {isChatMode && (
        <Button
          className={cn(
            'text-components-button-secondary-text',
            theme === 'dark' && 'rounded-lg border border-black/5 bg-white/10 backdrop-blur-sm',
          )}
          onClick={handleShowFeatures}
        >
          <RiApps2AddLine className='mr-1 h-4 w-4 text-components-button-secondary-text' />
          {t('workflow.common.features')}
        </Button>
      )}
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
          workflowToolAvailable: lastPublishedHasUserInput,
          crossAxisOffset: 4,
        }}
      />
    </>
  )
}

export default memo(FeaturesTrigger)
