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
        group relative w-[240px] bg-[#fcfdff] rounded-2xl shadow-xs
        hover:shadow-lg
        ${(data.selected && selected) ? 'border-[2px] border-primary-600' : 'border border-white'}
      `}
      onClick={() => handleSelectNode({ id: nodeId, data })}
    >
      <NodeControl />
      <div className='flex items-center px-3 pt-3 pb-2'>
        <BlockIcon
          className='shrink-0 mr-2'
          type={data.type}
          size='md'
        />
        <div
          title={data.title}
          className='text-[13px] font-semibold text-gray-700 truncate'
        >
          {data.title}
        </div>
      </div>
      {
        children && (
          <div className='mb-1'>
            {cloneElement(children, { id: nodeId, data })}
          </div>
        )
      }
      <div className='pb-1'>
        {
          data.desc && (
            <div className='px-3 pt-1 pb-2 text-xs leading-[18px] text-gray-500 whitespace-pre-line break-words'>
              {data.desc}
            </div>
          )
        }
      </div>
    </div>
  )
}

export default memo(BaseNode)
