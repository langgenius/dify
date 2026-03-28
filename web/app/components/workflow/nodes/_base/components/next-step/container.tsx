import type {
  CommonNodeType,
  Node,
} from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import Add from './add'
import Item from './item'

type ContainerProps = {
  nodeId: string
  nodeData: CommonNodeType
  sourceHandle: string
  nextNodes: Node[]
  branchName?: string
  isFailBranch?: boolean
}

const Container = ({
  nodeId,
  nodeData,
  sourceHandle,
  nextNodes,
  branchName,
  isFailBranch,
}: ContainerProps) => {
  return (
    <div className={cn(
      'space-y-0.5 rounded-[10px] bg-background-section-burn p-0.5',
      isFailBranch && 'border-[0.5px] border-state-warning-hover-alt bg-state-warning-hover',
    )}
    >
      {
        branchName && (
          <div
            className={cn(
              'system-2xs-semibold-uppercase flex items-center truncate px-2 text-text-tertiary',
              isFailBranch && 'text-text-warning',
            )}
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
            sourceHandle="source"
          />
        ))
      }
      <Add
        isParallel={!!nextNodes.length}
        isFailBranch={isFailBranch}
        nodeId={nodeId}
        nodeData={nodeData}
        sourceHandle={sourceHandle}
      />
    </div>
  )
}

export default Container
