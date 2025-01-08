import { useStoreApi } from 'reactflow'

const useNodeInfo = (nodeId: string) => {
  const store = useStoreApi()
  const {
    getNodes,
  } = store.getState()
  const allNodes = getNodes()
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
