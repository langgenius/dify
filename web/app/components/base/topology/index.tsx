import ReactFlow, {
  Background,
  MarkerType,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import './index.css'
import ServiceNode from './service-node'
import CustomSelfLoopEdge from './loop-edges'
import { useEffect, useMemo, useRef } from 'react'
import { layout as dagreLayout, graphlib } from '@dagrejs/dagre'
const nodeWidth = 200
const defaultNodeTypes = {
  serviceNode: ServiceNode,
  // moreNode: MoreNode,
} // 定义在组件外部
const edgeTypes = {
  // smart: SmartBezierEdge, // 或者使用 SmartBezierEdge 等
  loop: CustomSelfLoopEdge,
}
const LayoutFlow = (props) => {
  const { data, nodeHeight = 60, nodeTypes = {} } = props
  // 所有链路
  const reactFlowInstance = useRef(null)
  // const [initialNodes, setInitialNodes] = useState([])
  // const [initialEdges, setInitialEdges] = useState([])
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  const { fitView } = useReactFlow()
  const markerEnd = {
    type: MarkerType.ArrowClosed,
    strokeWidth: 5,
    width: 25,
    height: 25,
    color: '#6293ff',
  }
  const prepareData = () => {
    const initialNodes = data?.nodes || []
    const initialEdges = []
    data.edges.forEach((edge) => {
      initialEdges.push({
        ...edge,
        markerEnd,
        style: {
          stroke: '#6293FF',
        },
      })
    })
    return { initialNodes, initialEdges }
  }

  const dagreGraph = new graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))

  const getLayoutedElements = (nodes, edges) => {
    dagreGraph.setGraph({ rankdir: 'LR', ranksep: 100, nodesep: 50 }) // 自上而下的布局

    nodes.forEach((node) => {
      dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight })
    })

    edges.forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target)
    })

    dagreLayout(dagreGraph)
    nodes.forEach((node) => {
      const nodeWithPosition = dagreGraph.node(node.id)
      node.targetPosition = 'left'
      node.sourcePosition = 'right'

      node.position = {
        x: nodeWithPosition.x - nodeWidth,
        y: nodeWithPosition.y - nodeHeight / 2,
      }
    })

    // Calculate offsets to center the graph
    const xMin = Math.min(...nodes.map(node => node.position.x))
    const yMin = Math.min(...nodes.map(node => node.position.y))

    nodes.forEach((node) => {
      node.position.x -= xMin - nodeWidth / 2
      node.position.y -= yMin - nodeHeight / 2
    })
    edges.map((edge) => {
      const sourceNode = nodes.find(node => node.id === edge.source)
      const targetNode = nodes.find(node => node.id === edge.target)
      if (
        sourceNode.position.x > targetNode.position.x
        && Math.abs(sourceNode.position.y - targetNode.position.y) < nodeHeight
      )
        edge.type = 'loop'
    })
    return { nodes, edges }
  }

  useEffect(() => {
    console.log(data)
    const { initialNodes, initialEdges } = prepareData()
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      initialNodes,
      initialEdges,
    )
    setNodes([...layoutedNodes])
    setEdges([...layoutedEdges])
    requestAnimationFrame(() => {
      if (reactFlowInstance.current) {
        setTimeout(() => {
          fitView({
            padding: layoutedNodes.length > 2 ? 0.1 : 0.2,
            includeHiddenNodes: true,
          })
        }, 20)
      }
    })
  }, [data])
  const memoNodeTypes = useMemo(() => ({ ...nodeTypes, ...defaultNodeTypes }), [])
  return (

    <ReactFlow
      fitView
      nodes={nodes}
      edges={edges}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={memoNodeTypes}
      ref={reactFlowInstance}
      minZoom={0.1} // 设置最小缩放
      maxZoom={2} // 设置最大缩放
    >
      <Background
        gap={[14, 14]}
        size={2}
        className="bg-workflow-canvas-workflow-bg"
        color='var(--color-workflow-canvas-workflow-dot-color)'
      />
    </ReactFlow>

  )
}
function FlowWithProvider(props) {
  return (

    <ReactFlowProvider>
      <svg style={{ position: 'absolute', top: 0, left: 0 }}>
        <defs>
          <marker
            id="arrowhead"
            viewBox="0 0 74.4539794921875 67"
            refX="37.227"
            refY="33.5"
            markerWidth="16"
            markerHeight="16"
          >
            <path
              d="M45.4542 4.75L73.167 52.75C76.8236 59.0833 72.2529 67 64.9398 67L9.51418 67C2.20107 67 -2.36962 59.0833 1.28693 52.75L28.9997 4.75C32.6563 -1.58334 41.7977 -1.58334 45.4542 4.75Z"
              fill="#6293ff"
            />
          </marker>
        </defs>
      </svg>

      <LayoutFlow {...props} />
    </ReactFlowProvider>
  )
}
export default FlowWithProvider
