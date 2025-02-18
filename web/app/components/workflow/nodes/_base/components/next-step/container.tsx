import Add from './add'
import Item from './item'
import type {
  CommonNodeType,
  Node,
} from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

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
      'bg-background-section-burn space-y-0.5 rounded-[10px] p-0.5',
      isFailBranch && 'border-state-warning-hover-alt bg-state-warning-hover border-[0.5px]',
    )}>
      {
        branchName && (
          <div
            className={cn(
              'system-2xs-semibold-uppercase text-text-tertiary flex items-center truncate px-2',
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
            sourceHandle='source'
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
