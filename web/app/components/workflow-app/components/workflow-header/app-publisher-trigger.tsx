import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useEdges, useNodes, useStore as useReactflowStore } from 'reactflow'
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
} from '@/app/components/workflow/hooks'
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

const AppPublisherTrigger = () => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const appDetail = useAppStore(s => s.appDetail)
  const appID = appDetail?.id
  const setAppDetail = useAppStore(s => s.setAppDetail)
  const { nodesReadOnly } = useNodesReadOnly()
  const publishedAt = useStore(s => s.publishedAt)
  const draftUpdatedAt = useStore(s => s.draftUpdatedAt)
  const toolPublished = useStore(s => s.toolPublished)
  const startVariables = useReactflowStore(
    s => s.getNodes().find(node => node.data.type === BlockEnum.Start)?.data.variables,
  )
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

  const resetWorkflowVersionHistory = useResetWorkflowVersionHistory(appDetail!.id)
  const invalidateAppTriggers = useInvalidateAppTriggers()

  const updateAppDetail = useCallback(async () => {
    try {
      const res = await fetchAppDetail({ url: '/apps', id: appID! })
      setAppDetail({ ...res })
    }
    catch (error) {
      console.error(error)
    }
  }, [appID, setAppDetail])

  const { mutateAsync: publishWorkflow } = usePublishWorkflow(appID!)
  const nodes = useNodes<CommonNodeType>()
  const edges = useEdges<CommonEdgeType>()
  const needWarningNodes = useChecklist(nodes, edges)

  const updatePublishedWorkflow = useInvalidateAppWorkflow()
  const onPublish = useCallback(async (params?: PublishWorkflowParams) => {
    // First check if there are any items in the checklist
    if (needWarningNodes.length > 0) {
      notify({ type: 'error', message: t('workflow.panel.checklistTip') })
      throw new Error('Checklist has unresolved items')
    }

    // Then perform the detailed validation
    if (await handleCheckBeforePublish()) {
      const res = await publishWorkflow({
        title: params?.title || '',
        releaseNotes: params?.releaseNotes || '',
      })

      if (res) {
        notify({ type: 'success', message: t('common.api.actionSuccess') })
        updatePublishedWorkflow(appID!)
        updateAppDetail()
        invalidateAppTriggers(appID!)
        workflowStore.getState().setPublishedAt(res.created_at)
        resetWorkflowVersionHistory()
      }
    }
    else {
      throw new Error('Checklist failed')
    }
  }, [needWarningNodes, handleCheckBeforePublish, publishWorkflow, notify, t, updatePublishedWorkflow, appID, updateAppDetail, invalidateAppTriggers, workflowStore, resetWorkflowVersionHistory])

  const onPublisherToggle = useCallback((state: boolean) => {
    if (state)
      handleSyncWorkflowDraft(true)
  }, [handleSyncWorkflowDraft])

  const handleToolConfigureUpdate = useCallback(() => {
    workflowStore.setState({ toolPublished: true })
  }, [workflowStore])

  return (
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
  )
}

export default memo(AppPublisherTrigger)
