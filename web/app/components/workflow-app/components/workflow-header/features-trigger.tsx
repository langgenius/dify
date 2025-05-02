import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useNodes } from 'reactflow'
import { RiApps2AddLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import {
  useChecklistBeforePublish,
  useNodesReadOnly,
  useNodesSyncDraft,
} from '@/app/components/workflow/hooks'
import Button from '@/app/components/base/button'
import AppPublisher from '@/app/components/app/app-publisher'
import { useFeatures } from '@/app/components/base/features/hooks'
import {
  BlockEnum,
  InputVarType,
} from '@/app/components/workflow/types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import { useToastContext } from '@/app/components/base/toast'
import { usePublishWorkflow, useResetWorkflowVersionHistory } from '@/service/use-workflow'
import type { PublishWorkflowParams } from '@/types/workflow'
import { fetchAppDetail, fetchAppSSO } from '@/service/apps'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useSelector as useAppSelector } from '@/context/app-context'

const FeaturesTrigger = () => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const appDetail = useAppStore(s => s.appDetail)
  const appID = appDetail?.id
  const setAppDetail = useAppStore(s => s.setAppDetail)
  const systemFeatures = useAppSelector(state => state.systemFeatures)
  const {
    nodesReadOnly,
    getNodesReadOnly,
  } = useNodesReadOnly()
  const publishedAt = useStore(s => s.publishedAt)
  const draftUpdatedAt = useStore(s => s.draftUpdatedAt)
  const toolPublished = useStore(s => s.toolPublished)
  const nodes = useNodes<StartNodeType>()
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
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

  const { handleCheckBeforePublish } = useChecklistBeforePublish()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { notify } = useToastContext()

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

  const resetWorkflowVersionHistory = useResetWorkflowVersionHistory(appDetail!.id)

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
    if (await handleCheckBeforePublish()) {
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

  const onPublisherToggle = useCallback((state: boolean) => {
    if (state)
      handleSyncWorkflowDraft(true)
  }, [handleSyncWorkflowDraft])

  const handleToolConfigureUpdate = useCallback(() => {
    workflowStore.setState({ toolPublished: true })
  }, [workflowStore])

  return (
    <>
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
    </>
  )
}

export default memo(FeaturesTrigger)
