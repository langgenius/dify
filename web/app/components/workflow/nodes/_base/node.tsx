import type {
  FC,
  ReactElement,
} from 'react'
import {
  cloneElement,
  memo,
} from 'react'
import type { NodeProps } from '../../types'
import { BlockEnum } from '../../types'
import {
  NodeSourceHandle,
  NodeTargetHandle,
} from './components/node-handle'
import BlockIcon from '@/app/components/workflow/block-icon'

type BaseNodeProps = {
  children: ReactElement
} & NodeProps

const BaseNode: FC<BaseNodeProps> = ({
  id,
  data,
  children,
}) => {
  return (
    <div
      className={`
        group relative w-[240px] bg-[#fcfdff] rounded-2xl shadow-xs
        hover:shadow-lg
        ${data._selected ? 'border-[2px] border-primary-600' : 'border border-white'}
      `}
    >
      {
        data.type !== BlockEnum.VariableAssigner && (
          <NodeTargetHandle
            id={id}
            data={data}
            handleClassName='!top-[17px] !-left-2'
            handleId='target'
          />
        )
      }
      {
        data.type !== BlockEnum.IfElse && data.type !== BlockEnum.QuestionClassifier && (
          <NodeSourceHandle
            id={id}
            data={data}
            handleClassName='!top-[17px] !-right-2'
            handleId='source'
          />
        )
      }
      <div className='flex items-center px-3 pt-3 pb-2'>
        <BlockIcon
          className='shrink-0 mr-2'
          type={data.type}
          size='md'
          icon={data._icon}
        />
        <div
          title={data.title}
          className='grow text-[13px] font-semibold text-gray-700 truncate'
        >
          {data.title}
        </div>
      </div>
      <div className='mb-1'>
        {cloneElement(children, { id, data })}
      </div>
      {
        data.desc && (
          <div className='px-3 pt-s1 pb-2 text-xs leading-[18px] text-gray-500 whitespace-pre-line break-words'>
            {data.desc}
          </div>
        )
      }
    </div>
  )
}

export default memo(BaseNode)
