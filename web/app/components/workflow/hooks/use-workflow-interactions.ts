import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow } from 'reactflow'
import { useWorkflowStore } from '../store'
import { DSL_EXPORT_CHECK, WORKFLOW_DATA_UPDATE } from '../constants'
import type { WorkflowDataUpdator } from '../types'
import {
  initialEdges,
  initialNodes,
} from '../utils'
import { useEdgesInteractions } from './use-edges-interactions'
import { useNodesInteractions } from './use-nodes-interactions'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { fetchWorkflowDraft } from '@/service/workflow'
import { exportAppConfig } from '@/service/apps'
import { useToastContext } from '@/app/components/base/toast'
import { useStore as useAppStore } from '@/app/components/app/store'

export const useWorkflowInteractions = () => {
  const workflowStore = useWorkflowStore()
  const { handleNodeCancelRunningStatus } = useNodesInteractions()
  const { handleEdgeCancelRunningStatus } = useEdgesInteractions()

  const handleCancelDebugAndPreviewPanel = useCallback(() => {
    workflowStore.setState({
      showDebugAndPreviewPanel: false,
      workflowRunningData: undefined,
    })
    handleNodeCancelRunningStatus()
    handleEdgeCancelRunningStatus()
  }, [workflowStore, handleNodeCancelRunningStatus, handleEdgeCancelRunningStatus])

  return {
    handleCancelDebugAndPreviewPanel,
  }
}

export const useWorkflowUpdate = () => {
  const reactflow = useReactFlow()
  const workflowStore = useWorkflowStore()
  const { eventEmitter } = useEventEmitterContextContext()

  const handleUpdateWorkflowCanvas = useCallback((payload: WorkflowDataUpdator) => {
    const {
      nodes,
      edges,
      viewport,
    } = payload
    const { setViewport } = reactflow
    eventEmitter?.emit({
      type: WORKFLOW_DATA_UPDATE,
      payload: {
        nodes: initialNodes(nodes, edges),
        edges: initialEdges(edges, nodes),
      },
    } as any)
    setViewport(viewport)
  }, [eventEmitter, reactflow])

  const handleRefreshWorkflowDraft = useCallback(() => {
    const {
      appId,
      setSyncWorkflowDraftHash,
      setIsSyncingWorkflowDraft,
      setEnvironmentVariables,
      setEnvSecrets,
    } = workflowStore.getState()
    setIsSyncingWorkflowDraft(true)
    fetchWorkflowDraft(`/apps/${appId}/workflows/draft`).then((response) => {
      handleUpdateWorkflowCanvas(response.graph as WorkflowDataUpdator)
      setSyncWorkflowDraftHash(response.hash)
      setEnvSecrets((response.environment_variables || []).filter(env => env.value_type === 'secret').reduce((acc, env) => {
        acc[env.id] = env.value
        return acc
      }, {} as Record<string, string>))
      setEnvironmentVariables(response.environment_variables?.map(env => env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env) || [])
    }).finally(() => setIsSyncingWorkflowDraft(false))
  }, [handleUpdateWorkflowCanvas, workflowStore])

  return {
    handleUpdateWorkflowCanvas,
    handleRefreshWorkflowDraft,
  }
}

export const useDSL = () => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { eventEmitter } = useEventEmitterContextContext()
  const [exporting, setExporting] = useState(false)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()

  const appDetail = useAppStore(s => s.appDetail)

  const handleExportDSL = useCallback(async (include = false) => {
    if (!appDetail)
      return

    if (exporting)
      return

    try {
      setExporting(true)
      await doSyncWorkflowDraft()
      const { data } = await exportAppConfig({
        appID: appDetail.id,
        include,
      })
      const a = document.createElement('a')
      const file = new Blob([data], { type: 'application/yaml' })
      a.href = URL.createObjectURL(file)
      a.download = `${appDetail.name}.yml`
      a.click()
    }
    catch (e) {
      notify({ type: 'error', message: t('app.exportFailed') })
    }
    finally {
      setExporting(false)
    }
  }, [appDetail, notify, t, doSyncWorkflowDraft, exporting])

  const exportCheck = useCallback(async () => {
    if (!appDetail)
      return
    try {
      const workflowDraft = await fetchWorkflowDraft(`/apps/${appDetail?.id}/workflows/draft`)
      const list = (workflowDraft.environment_variables || []).filter(env => env.value_type === 'secret')
      if (list.length === 0) {
        handleExportDSL()
        return
      }
      eventEmitter?.emit({
        type: DSL_EXPORT_CHECK,
        payload: {
          data: list,
        },
      } as any)
    }
    catch (e) {
      notify({ type: 'error', message: t('app.exportFailed') })
    }
  }, [appDetail, eventEmitter, handleExportDSL, notify, t])

  return {
    exportCheck,
    handleExportDSL,
  }
}
