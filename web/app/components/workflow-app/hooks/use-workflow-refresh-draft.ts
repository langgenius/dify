import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { START_INITIAL_POSITION } from '@/app/components/workflow/constants'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks'
import startPlaceholderDefault from '@/app/components/workflow/nodes/start-placeholder/default'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { generateNewNode } from '@/app/components/workflow/utils'
import { fetchWorkflowDraft } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'

const hasWorkflowEntryNode = (nodes: WorkflowDataUpdater['nodes'] = []): boolean => {
  return nodes.some(node => (
    node?.data?.type === BlockEnum.Start
    || node?.data?.type === BlockEnum.TriggerSchedule
    || node?.data?.type === BlockEnum.TriggerWebhook
    || node?.data?.type === BlockEnum.TriggerPlugin
  ))
}

const hasStartPlaceholderNode = (nodes: WorkflowDataUpdater['nodes'] = []): boolean => {
  return nodes.some(node => node?.data?.type === BlockEnum.StartPlaceholder)
}

export const useWorkflowRefreshDraft = () => {
  const { t } = useTranslation()
  const appDetail = useAppStore(s => s.appDetail)
  const workflowStore = useWorkflowStore()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()

  const getNodesWithLocalStartPlaceholder = useCallback((nodes: WorkflowDataUpdater['nodes']) => {
    if (appDetail?.mode !== AppModeEnum.WORKFLOW || hasWorkflowEntryNode(nodes) || hasStartPlaceholderNode(nodes))
      return nodes

    const { newNode: startPlaceholderNode } = generateNewNode({
      data: {
        ...startPlaceholderDefault.defaultValue,
        selected: true,
        type: startPlaceholderDefault.metaData.type,
        title: t(`blocks.${startPlaceholderDefault.metaData.type}`, { ns: 'workflow' }),
        desc: '',
      },
      position: START_INITIAL_POSITION,
    })

    return [startPlaceholderNode, ...nodes]
  }, [appDetail?.mode, t])

  const handleRefreshWorkflowDraft = useCallback((notUpdateCanvas?: boolean) => {
    const {
      appId,
      setSyncWorkflowDraftHash,
      setIsSyncingWorkflowDraft,
      setEnvironmentVariables,
      setEnvSecrets,
      setConversationVariables,
      setIsWorkflowDataLoaded,
      isWorkflowDataLoaded,
      debouncedSyncWorkflowDraft,
    } = workflowStore.getState()

    if (debouncedSyncWorkflowDraft && typeof (debouncedSyncWorkflowDraft as any).cancel === 'function')
      (debouncedSyncWorkflowDraft as any).cancel()

    const wasLoaded = isWorkflowDataLoaded
    if (wasLoaded)
      setIsWorkflowDataLoaded(false)
    setIsSyncingWorkflowDraft(true)
    fetchWorkflowDraft(`/apps/${appId}/workflows/draft`)
      .then((response) => {
        // Ensure we have a valid workflow structure with viewport
        if (!notUpdateCanvas) {
          const nodes = response.graph?.nodes || []
          const workflowData: WorkflowDataUpdater = {
            nodes: getNodesWithLocalStartPlaceholder(nodes),
            edges: response.graph?.edges || [],
            viewport: response.graph?.viewport || { x: 0, y: 0, zoom: 1 },
          }
          handleUpdateWorkflowCanvas(workflowData)
        }
        setSyncWorkflowDraftHash(response.hash)
        setEnvSecrets((response.environment_variables || []).filter(env => env.value_type === 'secret').reduce((acc, env) => {
          acc[env.id] = env.value
          return acc
        }, {} as Record<string, string>))
        setEnvironmentVariables(response.environment_variables?.map(env => env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env) || [])
        setConversationVariables(response.conversation_variables || [])
        setIsWorkflowDataLoaded(true)
      })
      .catch(() => {
        if (wasLoaded)
          setIsWorkflowDataLoaded(true)
      })
      .finally(() => {
        setIsSyncingWorkflowDraft(false)
      })
  }, [getNodesWithLocalStartPlaceholder, handleUpdateWorkflowCanvas, workflowStore])

  return {
    handleRefreshWorkflowDraft,
  }
}
