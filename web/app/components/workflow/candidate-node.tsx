import { memo } from 'react'
import produce from 'immer'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import { useEventListener } from 'ahooks'
import {
  useStore,
  useWorkflowStore,
} from './store'
import CustomNode from './nodes'

type CandidateNodeProps = {
  mouse: {
    pageX: number
    pageY: number
    elementX: number
    elementY: number
  }
}
const CandidateNode = ({
  mouse,
}: CandidateNodeProps) => {
  const store = useStoreApi()
  const reactflow = useReactFlow()
  const workflowStore = useWorkflowStore()
  const candidateNode = useStore(s => s.candidateNode)

  useEventListener('click', (e) => {
    const { candidateNode } = workflowStore.getState()

    if (candidateNode) {
      e.preventDefault()
      const {
        getNodes,
        setNodes,
      } = store.getState()
      const { screenToFlowPosition } = reactflow
      const nodes = getNodes()
      const { x, y } = screenToFlowPosition({ x: mouse.pageX, y: mouse.pageY })
      const newNodes = produce(nodes, (draft) => {
        draft.push({
          ...candidateNode,
          data: {
            ...candidateNode.data,
            _isCandidate: false,
          },
          position: {
            x,
            y,
          },
        })
      })
      setNodes(newNodes)
      workflowStore.setState({ candidateNode: undefined })
    }
  })

  useEventListener('contextmenu', (e) => {
    const { candidateNode } = workflowStore.getState()
    if (candidateNode) {
      e.preventDefault()
      workflowStore.setState({ candidateNode: undefined })
    }
  })

  if (!candidateNode)
    return null

  return (
    <div
      className='absolute z-10'
      style={{
        left: mouse.elementX,
        top: mouse.elementY,
      }}
    >
      <CustomNode {...candidateNode as any} />
    </div>
  )
}

export default memo(CandidateNode)
