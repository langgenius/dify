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
      'p-0.5 space-y-0.5 rounded-[10px] bg-background-section-burn',
      isFailBranch && 'border-[0.5px] border-state-warning-hover-alt bg-state-warning-hover',
    )}>
      {
        branchName && (
          <div
            className={cn(
              'flex items-center px-2 system-2xs-semibold-uppercase text-text-tertiary truncate',
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
