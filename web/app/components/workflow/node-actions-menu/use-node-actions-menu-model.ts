import type { Node } from '@/app/components/workflow/types'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useEdges } from 'reactflow'
import { CollectionType } from '@/app/components/tools/types'
import { selectToolsWithProvider } from '@/app/components/tools/utils/query-select'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import { canRunBySingle } from '@/app/components/workflow/utils'
import { consoleQuery } from '@/service/console'
import { matchesProviderReference } from '@/utils/provider-reference'
import { useNodesInteractions } from '../hooks/use-nodes-interactions'
import { useNodeMetaData } from '../hooks/use-nodes-meta-data'
import { useSingleRunAuthorization } from '../hooks/use-single-run-authorization'
import { useNodesReadOnly } from '../hooks/use-workflow'

type UseNodeActionsMenuModelParams = {
  id: string
  data: Node['data']
  onClose: () => void
  showHelpLink?: boolean
}

export function useNodeActionsMenuModel({
  id,
  data,
  onClose,
  showHelpLink = true,
}: UseNodeActionsMenuModelParams) {
  const edges = useEdges()
  const { handleNodeDelete, handleNodesDuplicate, handleNodeSelect, handleNodesCopy } =
    useNodesInteractions()
  const workflowStore = useWorkflowStore()
  const { nodesReadOnly } = useNodesReadOnly()
  const canRunWorkflow = useHooksStore((s) => s.accessControl.canRun)
  const nodeMetaData = useNodeMetaData({ id, data } as Node)
  const { data: workflowTools } = useQuery(
    consoleQuery.workspaces.current.tools.workflow.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )

  const isChildNode = !!(data.isInIteration || data.isInLoop)
  const canRun = canRunWorkflow && !nodesReadOnly && canRunBySingle(data.type, isChildNode)
  const isSingleRunning = data._singleRunningStatus === NodeRunningStatus.Running
  const { disabledReason } = useSingleRunAuthorization(id, data)
  const singleRunDisabledReason = isSingleRunning ? undefined : disabledReason
  const canChangeBlock = !nodeMetaData.isTypeFixed && !nodeMetaData.isUndeletable && !nodesReadOnly
  const sourceHandle = useMemo(() => {
    return edges.find((edge) => edge.target === id)?.sourceHandle || 'source'
  }, [edges, id])

  const workflowAppHref = useMemo(() => {
    const isWorkflowTool =
      data.type === BlockEnum.Tool && data.provider_type === CollectionType.workflow
    if (!isWorkflowTool || !workflowTools || !data.provider_id) return undefined

    const workflowTool = workflowTools.find((item) =>
      matchesProviderReference(item, data.provider_id),
    )
    if (!workflowTool?.workflow_app_id) return undefined

    return `/app/${workflowTool.workflow_app_id}/workflow`
  }, [data.provider_id, data.provider_type, data.type, workflowTools])

  const handleRun = useCallback(() => {
    if (singleRunDisabledReason) return
    const store = workflowStore.getState()
    store.setInitShowLastRunTab(true)
    store.setPendingSingleRun({
      nodeId: id,
      action: isSingleRunning ? 'stop' : 'run',
    })
    handleNodeSelect(id)
    onClose()
  }, [handleNodeSelect, id, isSingleRunning, onClose, workflowStore, singleRunDisabledReason])

  const handleCopy = useCallback(() => {
    onClose()
    handleNodesCopy(id)
  }, [handleNodesCopy, id, onClose])

  const handleDuplicate = useCallback(() => {
    onClose()
    handleNodesDuplicate(id)
  }, [handleNodesDuplicate, id, onClose])

  const handleDelete = useCallback(() => {
    onClose()
    handleNodeDelete(id)
  }, [handleNodeDelete, id, onClose])

  return {
    about: {
      author: nodeMetaData.author,
      description: nodeMetaData.description,
    },
    canChangeBlock,
    canRun,
    data,
    handleCopy,
    handleDelete,
    handleDuplicate,
    handleRun,
    helpLinkUri: showHelpLink ? nodeMetaData.helpLinkUri : undefined,
    id,
    isSingleton: nodeMetaData.isSingleton,
    isSingleRunning,
    singleRunDisabledReason,
    isUndeletable: nodeMetaData.isUndeletable,
    nodesReadOnly,
    sourceHandle,
    workflowAppHref,
  }
}
