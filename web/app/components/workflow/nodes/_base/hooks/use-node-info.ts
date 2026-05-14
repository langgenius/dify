import { useWorkflowStoreApi } from '@/app/components/workflow/hooks/use-workflow-reactflow'

const useNodeInfo = (nodeId: string) => {
  const store = useWorkflowStoreApi()
  const {
    nodes,
  } = store.getState()
  const allNodes = nodes
  const node = allNodes.find(n => n.id === nodeId)
  const isInIteration = !!node?.data.isInIteration
  const isInLoop = !!node?.data.isInLoop
  const parentNodeId = node?.parentId
  const parentNode = allNodes.find(n => n.id === parentNodeId)
  return {
    node,
    isInIteration,
    isInLoop,
    parentNode,
  }
}

export default useNodeInfo
