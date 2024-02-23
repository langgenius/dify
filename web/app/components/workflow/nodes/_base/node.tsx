import type {
  FC,
  ReactElement,
} from 'react'
import {
  cloneElement,
  memo,
} from 'react'
import type { NodeProps } from 'reactflow'
import BlockIcon from '../../block-icon'
import { useWorkflow } from '../../hooks'
import BlockSelector from '../../block-selector'
import NodeControl from './components/node-control'

type BaseNodeProps = {
  children: ReactElement
} & NodeProps

const BaseNode: FC<BaseNodeProps> = ({
  id: nodeId,
  data,
  selected,
  children,
}) => {
  const { handleSelectNode } = useWorkflow()

  return (
    <div
      className={`
        group relative pb-2 w-[240px] bg-[#fcfdff] rounded-2xl shadow-xs
        hover:shadow-lg
        ${(data.selected && selected) ? 'border-[2px] border-primary-600' : 'border border-white'}
      `}
      onClick={() => handleSelectNode({ id: nodeId, data })}
    >
      <NodeControl />
      <div className='flex items-center px-3 pt-3 pb-2'>
        <BlockIcon
          className='mr-2'
          type={data.type}
          size='md'
        />
        <div className='text-[13px] font-semibold text-gray-700'>
          {data.title}
        </div>
      </div>
      {cloneElement(children, { id: nodeId, data })}
      <div className='px-3 pt-1 pb-1 text-xs text-gray-500'>
        Define the initial parameters for launching a workflow
      </div>
      <BlockSelector
        onSelect={() => {}}
        asChild
      />
    </div>
  )
}

export default memo(BaseNode)
