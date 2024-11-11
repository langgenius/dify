import Add from './add'
import Item from './item'
import type {
  CommonNodeType,
  Node,
} from '@/app/components/workflow/types'

type ContainerProps = {
  nodeId: string
  nodeData: CommonNodeType
  sourceHandle: string
  nextNodes: Node[]
  branchName?: string
}

const Container = ({
  nodeId,
  nodeData,
  sourceHandle,
  nextNodes,
  branchName,
}: ContainerProps) => {
  return (
    <div className='p-0.5 space-y-0.5 rounded-[10px] bg-background-section-burn'>
      {
        branchName && (
          <div
            className='flex items-center px-2 system-2xs-semibold-uppercase text-text-tertiary truncate'
            title={branchName}
          >
            {branchName}
          </div>
        )
      }
      {
        nextNodes.map(nextNode => (
          <Item
            key={nextNode.id}
            nodeId={nextNode.id}
            data={nextNode.data}
            sourceHandle='source'
          />
        ))
      }
      <Add
        isParallel={!!nextNodes.length}
        nodeId={nodeId}
        nodeData={nodeData}
        sourceHandle={sourceHandle}
      />
    </div>
  )
}

export default Container
