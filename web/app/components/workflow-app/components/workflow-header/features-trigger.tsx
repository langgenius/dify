import type { EndNodeType } from '@/app/components/workflow/nodes/end/types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type {
  CommonEdgeType,
  Node,
} from '@/app/components/workflow/types'
import type { PublishWorkflowParams } from '@/types/workflow'
import { RiApps2AddLine } from '@remixicon/react'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useEdges } from 'reactflow'
import AppPublisher from '@/app/components/app/app-publisher'
import { useStore as useAppStore } from '@/app/components/app/store'
import Button from '@/app/components/base/button'
import { useFeatures } from '@/app/components/base/features/hooks'
import { useToastContext } from '@/app/components/base/toast'
import { Plan } from '@/app/components/billing/type'
import {
  useChecklist,
  useChecklistBeforePublish,
  useIsChatMode,
  useNodesReadOnly,
  useNodesSyncDraft,
  // useWorkflowRunValidation,
} from '@/app/components/workflow/hooks'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import {
  BlockEnum,
  InputVarType,
  isTriggerNode,
} from '@/app/components/workflow/types'
import { useProviderContext } from '@/context/provider-context'
import useTheme from '@/hooks/use-theme'
import { fetchAppDetail } from '@/service/apps'
import { useInvalidateAppTriggers } from '@/service/use-tools'
import { useInvalidateAppWorkflow, usePublishWorkflow, useResetWorkflowVersionHistory } from '@/service/use-workflow'
import { cn } from '@/utils/classnames'

const FeaturesTrigger = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const isChatMode = useIsChatMode()
  const workflowStore = useWorkflowStore()
  const appDetail = useAppStore(s => s.appDetail)
  const appID = appDetail?.id
  const setAppDetail = useAppStore(s => s.setAppDetail)
  const { nodesReadOnly, getNodesReadOnly } = useNodesReadOnly()
  const { plan, isFetchedPlan } = useProviderContext()
  const publishedAt = useStore(s => s.publishedAt)
  const draftUpdatedAt = useStore(s => s.draftUpdatedAt)
  const toolPublished = useStore(s => s.toolPublished)
  const lastPublishedHasUserInput = useStore(s => s.lastPublishedHasUserInput)

  const nodes = useNodes()
  const hasWorkflowNodes = nodes.length > 0
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
  const endNode = nodes.find(node => node.data.type === BlockEnum.End)
  const startVariables = (startNode as Node<StartNodeType>)?.data?.variables
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
  const endVariables = useMemo(() => (endNode as Node<EndNodeType>)?.data?.outputs || [], [endNode])

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
  // Track trigger presence so the publisher can adjust UI (e.g. hide missing start section).
  const hasTriggerNode = useMemo(() => (
    nodes.some(node => isTriggerNode(node.data.type as BlockEnum))
  ), [nodes])
  const startNodeLimitExceeded = useMemo(() => {
    const entryCount = nodes.reduce((count, node) => {
      const nodeType = node.data.type as BlockEnum
      if (nodeType === BlockEnum.Start || isTriggerNode(nodeType))
        return count + 1
      return count
    }, 0)
    return isFetchedPlan && plan.type === Plan.sandbox && entryCount > 2
  }, [nodes, plan.type, isFetchedPlan])

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
      notify({ type: 'error', message: t('panel.checklistTip', { ns: 'workflow' }) })
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
        notify({ type: 'success', message: t('api.actionSuccess', { ns: 'common' }) })
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
            'rounded-lg border border-transparent text-components-button-secondary-text',
            theme === 'dark' && 'border-black/5 bg-white/10 backdrop-blur-sm',
          )}
          onClick={handleShowFeatures}
        >
          <RiApps2AddLine className="mr-1 h-4 w-4 text-components-button-secondary-text" />
          {t('common.features', { ns: 'workflow' })}
        </Button>
      )}
      <AppPublisher
        {...{
          publishedAt,
          draftUpdatedAt,
          disabled: nodesReadOnly || !hasWorkflowNodes,
          toolPublished,
          inputs: variables,
          outputs: endVariables,
          onRefreshData: handleToolConfigureUpdate,
          onPublish,
          onToggle: onPublisherToggle,
          workflowToolAvailable: lastPublishedHasUserInput,
          crossAxisOffset: 4,
          missingStartNode: !startNode,
          hasTriggerNode,
          startNodeLimitExceeded,
          publishDisabled: !hasWorkflowNodes || startNodeLimitExceeded,
        }}
      />
    </>
  )
}

export default memo(FeaturesTrigger)
