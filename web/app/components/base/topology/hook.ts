function escapeId(id: string) {
  return id.replace(/[^a-zA-Z0-9-_]/g, '_')
}
function contactServiceEndpoint(service: string, endpoint: string) {
  return escapeId(`${service}-${endpoint}`)
}
export const usePrepareTopologyData = (data) => {
  console.log(data)
  if (!data)
    return { nodes: [], edges: [] }

  const nodeSet = new Set() // 用于存储已添加节点的 ID
  const edgeSet = new Set() // 用于存储已添加边的 ID
  const current = data.current

  const nodes = [
    {
      id: contactServiceEndpoint(current.service, current.endpoint),
      data: {
        label: current.service,
        isTraced: current.isTraced,
        service: current.service,
        endpoint: current.endpoint,
      },
      position: { x: 0, y: 0 },
      type: 'serviceNode',
    },
  ]
  nodeSet.add(contactServiceEndpoint(current.service, current.endpoint))
  const edges = []
  data.parents?.forEach((parent) => {
    const nodeId = contactServiceEndpoint(parent.service, parent.endpoint)
    if (!nodeSet.has(nodeId)) {
      nodes.push({
        id: nodeId,
        data: {
          label: parent.service,
          isTraced: parent.isTraced,
          service: parent.service,
          endpoint: parent.endpoint,
        },
        position: { x: 0, y: 0 },
        type: 'serviceNode',
      })
      nodeSet.add(nodeId)
    }
    const edgeId = `${nodeId}-${contactServiceEndpoint(current.service, current.endpoint)}`
    if (!edgeSet.has(edgeId)) {
      const targetId = contactServiceEndpoint(current.service, current.endpoint)
      edges.push({
        id: edgeId,
        source: nodeId,
        target: targetId,
        type: nodeId === targetId ? 'loop' : 'smart',
        markerEnd: 'url(#arrowhead)',
      })
      edgeSet.add(edgeId)
    }
  })
  data.childRelations?.forEach((child, index) => {
    const nodeId = contactServiceEndpoint(child.service, child.endpoint)
    if (!nodeSet.has(nodeId)) {
      nodes.push({
        id: nodeId,
        data: {
          label: child.service,
          isTraced: child.isTraced,
          service: child.service,
          endpoint: child.endpoint,
        },
        position: { x: 0, y: 0 },
        type: 'serviceNode',
      })
      nodeSet.add(nodeId)
    }

    const edgeId
        = `${contactServiceEndpoint(child.parentService, child.parentEndpoint)}-${nodeId}`
    if (!edgeSet.has(edgeId)) {
      const sourceId = contactServiceEndpoint(child.parentService, child.parentEndpoint)
      edges.push({
        id: edgeId,
        source: sourceId,
        target: nodeId,
        type: nodeId === sourceId ? 'loop' : 'smart',
      })
      edgeSet.add(edgeId)
    }
  })
  const resultNodes = [...nodes]
  const result = resultNodes.reduce((acc, curr) => {
    acc[curr.id] = 1
    return acc
  }, {})
  console.log(result)
  // prepareDataForChartAndTopologyNode(result)
  return { nodes: resultNodes, edges }
}
