import ReactFlow, {
  Background,
} from 'reactflow'
import 'reactflow/dist/style.css'
import Header from './header'
import CustomNode from './nodes'
import CustomEdge from './custom-edge'

const nodeTypes = {
  custom: CustomNode,
}
const edgeTypes = {
  custom: CustomEdge,
}

const Workflow = () => {
  return (
    <div className='relative w-full h-full'>
      <Header />
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={[
          {
            id: 'start',
            type: 'custom',
            position: { x: 330, y: 30 },
            data: { list: [] },
          },
          {
            id: '1',
            type: 'custom',
            position: { x: 400, y: 250 },
            data: { list: [] },
          },
          {
            id: '2',
            type: 'custom',
            position: { x: 100, y: 250 },
            data: { list: [] },
          },
        ]}
        edges={[
          {
            id: 'e1-2',
            source: 'start',
            target: '1',
            type: 'custom',
          },
          {
            id: 'e1-3',
            source: 'start',
            target: '2',
            type: 'custom',
          },
        ]}
      >
        <Background
          gap={[14, 14]}
          size={1}
        />
      </ReactFlow>
    </div>
  )
}

export default Workflow
