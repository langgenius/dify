import type { Node } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import { useEdges } from 'reactflow'
import { CollectionType } from '@/app/components/tools/types'
import {
  useNodeDataUpdate,
  useNodeMetaData,
  useNodesInteractions,
  useNodesReadOnly,
  useNodesSyncDraft,
} from '@/app/components/workflow/hooks'
import { BlockEnum } from '@/app/components/workflow/types'
import { canRunBySingle } from '@/app/components/workflow/utils'
import { useAllWorkflowTools } from '@/service/use-tools'
import { canFindTool } from '@/utils'

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
  const {
    handleNodeDelete,
    handleNodesDuplicate,
    handleNodeSelect,
    handleNodesCopy,
  } = useNodesInteractions()
  const { handleNodeDataUpdate } = useNodeDataUpdate()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { nodesReadOnly } = useNodesReadOnly()
  const nodeMetaData = useNodeMetaData({ id, data } as Node)
  const { data: workflowTools } = useAllWorkflowTools()

  const isChildNode = !!(data.isInIteration || data.isInLoop)
  const canRun = canRunBySingle(data.type, isChildNode)
  const canChangeBlock = !nodeMetaData.isTypeFixed && !nodeMetaData.isUndeletable && !nodesReadOnly
  const sourceHandle = useMemo(() => {
    return edges.find(edge => edge.target === id)?.sourceHandle || 'source'
  }, [edges, id])

  const workflowAppHref = useMemo(() => {
    const isWorkflowTool = data.type === BlockEnum.Tool && data.provider_type === CollectionType.workflow
    if (!isWorkflowTool || !workflowTools || !data.provider_id)
      return undefined

    const workflowTool = workflowTools.find(item => canFindTool(item.id, data.provider_id))
    if (!workflowTool?.workflow_app_id)
      return undefined

    return `/app/${workflowTool.workflow_app_id}/workflow`
  }, [data.provider_id, data.provider_type, data.type, workflowTools])

  const handleRun = useCallback(() => {
    handleNodeSelect(id)
    handleNodeDataUpdate({ id, data: { _isSingleRun: true } })
    handleSyncWorkflowDraft(true)
    onClose()
  }, [handleNodeDataUpdate, handleNodeSelect, handleSyncWorkflowDraft, id, onClose])

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
    isUndeletable: nodeMetaData.isUndeletable,
    nodesReadOnly,
    sourceHandle,
    workflowAppHref,
  }
}
