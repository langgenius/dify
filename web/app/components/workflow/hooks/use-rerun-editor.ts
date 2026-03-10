import type { NodeTracing, VarInInspect } from '@/types/workflow'
import { isEqual } from 'es-toolkit/predicate'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import Toast from '@/app/components/base/toast'
import { BlockEnum } from '@/app/components/workflow/types'
import { fetchWorkflowRerunVariables } from '@/service/workflow-rerun'
import { AppModeEnum } from '@/types/app'
import { VarInInspectType } from '@/types/workflow'
import { useStore } from '../store'
import { adaptRerunVariables, RERUN_MASK_PLACEHOLDER } from '../variable-inspect/rerun-adapter'
import { useWorkflowRun } from './use-workflow-run'

const getRerunErrorCodeFromUnknown = async (error: unknown): Promise<{ code?: string, message?: string }> => {
  if (!(error instanceof Response))
    return {}

  const payload = await error.clone().json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
  const code = typeof payload?.code === 'string' ? payload.code : undefined
  const message = typeof payload?.message === 'string'
    ? payload.message
    : (typeof payload?.error === 'string' ? payload.error : undefined)
  return {
    code,
    message,
  }
}

type OpenRerunEditorParams = {
  sourceRunId?: string
  sourceRunStatus?: string
  nodeInfo: NodeTracing
}

export const useRerunEditor = () => {
  const { t } = useTranslation()
  const flowStore = useStoreApi()
  const {
    handleRerun,
  } = useWorkflowRun()

  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)
  const setVariableInspectMode = useStore(s => s.setVariableInspectMode)
  const setRerunContext = useStore(s => s.setRerunContext)
  const patchRerunContext = useStore(s => s.patchRerunContext)
  const clearRerunContext = useStore(s => s.clearRerunContext)
  const setCurrentFocusNodeId = useStore(s => s.setCurrentFocusNodeId)

  const rerunContext = useStore(s => s.rerunContext)

  const getRerunErrorMessage = useCallback((code?: string, fallbackMessage?: string) => {
    switch (code) {
      case 'invalid_param':
        return t('debug.rerun.errors.invalidParam', { ns: 'workflow' })
      case 'workflow_run_not_found':
      case 'target_node_not_found':
        return t('debug.rerun.errors.notFound', { ns: 'workflow' })
      case 'workflow_run_not_ended':
        return t('debug.rerun.errors.sourceNotEnded', { ns: 'workflow' })
      case 'unsupported_target_node_scope':
        return t('debug.rerun.errors.unsupportedScope', { ns: 'workflow' })
      case 'override_selector_invalid':
      case 'override_out_of_scope':
      case 'override_type_mismatch':
        return t('debug.rerun.errors.overrideInvalid', { ns: 'workflow' })
      case 'unsupported_app_mode':
        return t('debug.rerun.errors.unsupportedAppMode', { ns: 'workflow' })
      case 'rerun_execution_failed':
        return t('debug.rerun.errors.executionFailed', { ns: 'workflow' })
      default:
        return fallbackMessage || t('debug.rerun.errors.executionFailed', { ns: 'workflow' })
    }
  }, [t])

  const selectorByVarId = useMemo(() => {
    if (!rerunContext)
      return {}

    const result: Record<string, string[]> = {}
    rerunContext.nodeGroups.forEach((nodeGroup) => {
      nodeGroup.vars.forEach((item) => {
        result[item.id] = item.selector
      })
    })
    rerunContext.envVars.forEach((item: VarInInspect) => {
      result[item.id] = item.selector
    })
    return result
  }, [rerunContext])

  const getNodeMetaById = useCallback(() => {
    const { getNodes } = flowStore.getState()
    const nodes = getNodes()
    const metaById: Record<string, {
      nodeId: string
      title: string
      nodeType: BlockEnum
      nodePayload: typeof nodes[number]['data']
    }> = {}

    nodes.forEach((node) => {
      const title = node.data?.title || node.id
      const nodeType = node.data?.type || BlockEnum.VariableAssigner
      metaById[node.id] = {
        nodeId: node.id,
        title,
        nodeType,
        nodePayload: node.data,
      }

      // `start` is a selector alias in rerun API, map it back to real start node metadata.
      if (nodeType === BlockEnum.Start && !metaById.start) {
        metaById.start = {
          nodeId: node.id,
          title,
          nodeType,
          nodePayload: node.data,
        }
      }
    })

    return metaById
  }, [flowStore])

  const handleOpenRerunEditor = useCallback(async ({
    sourceRunId,
    sourceRunStatus,
    nodeInfo,
  }: OpenRerunEditorParams) => {
    const appDetail = useAppStore.getState().appDetail
    const isEndedSourceRun = !!sourceRunStatus && ['succeeded', 'failed', 'stopped', 'partial-succeeded'].includes(sourceRunStatus)
    if (!appDetail?.id || appDetail.mode !== AppModeEnum.WORKFLOW || !sourceRunId || !nodeInfo.node_id || !isEndedSourceRun)
      return

    setVariableInspectMode('rerun-edit')
    setShowVariableInspectPanel(true)
    setCurrentFocusNodeId('')
    setRerunContext({
      appId: appDetail.id,
      sourceRunId,
      sourceRunStatus: sourceRunStatus || '',
      targetNodeId: nodeInfo.node_id,
      loading: true,
      submitting: false,
      nodeGroups: [],
      envVars: [],
      originalValueByVarId: {},
      currentValueByVarId: {},
      metaByVarId: {},
    })

    try {
      const response = await fetchWorkflowRerunVariables(appDetail.id, sourceRunId, nodeInfo.node_id)
      const adapted = adaptRerunVariables(response, getNodeMetaById())
      setRerunContext({
        appId: appDetail.id,
        sourceRunId,
        sourceRunStatus: sourceRunStatus || '',
        targetNodeId: nodeInfo.node_id,
        loading: false,
        submitting: false,
        ...adapted,
      })

      const firstNodeGroup = adapted.nodeGroups[0]
      if (firstNodeGroup?.nodeId)
        setCurrentFocusNodeId(firstNodeGroup.nodeId)
      else if (adapted.envVars.length > 0)
        setCurrentFocusNodeId(VarInInspectType.environment)
    }
    catch (error) {
      const { code, message } = await getRerunErrorCodeFromUnknown(error)
      Toast.notify({
        type: 'error',
        message: getRerunErrorMessage(code, message),
      })
      setVariableInspectMode('cache')
      clearRerunContext()
    }
  }, [
    setVariableInspectMode,
    setShowVariableInspectPanel,
    setCurrentFocusNodeId,
    setRerunContext,
    getNodeMetaById,
    getRerunErrorMessage,
    clearRerunContext,
  ])

  const handleSubmitRerun = useCallback(async () => {
    if (!rerunContext)
      return

    patchRerunContext({ submitting: true })

    const overrides = Object.entries(rerunContext.currentValueByVarId).reduce<Array<{ selector: string[], value: unknown }>>((acc, [varId, currentValue]) => {
      const selector = selectorByVarId[varId]
      if (!selector)
        return acc

      const originalValue = rerunContext.originalValueByVarId[varId]
      const meta = rerunContext.metaByVarId[varId]
      const isChanged = !isEqual(currentValue, originalValue)
      if (!isChanged)
        return acc

      if (meta?.masked && currentValue === RERUN_MASK_PLACEHOLDER)
        return acc

      acc.push({
        selector,
        value: currentValue,
      })
      return acc
    }, [])

    try {
      await handleRerun({
        sourceRunId: rerunContext.sourceRunId,
        targetNodeId: rerunContext.targetNodeId,
        overrides,
      })
    }
    finally {
      patchRerunContext({ submitting: false })
    }
  }, [handleRerun, patchRerunContext, rerunContext, selectorByVarId])

  return {
    handleOpenRerunEditor,
    handleSubmitRerun,
  }
}
