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
import NodeControl from './components/node-control'
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
        flex border-[2px] rounded-2xl
        ${data.selected ? 'border-primary-600' : 'border-transparent'}
      `}
    >
      <div
        className={`
          group relative w-[240px] bg-[#fcfdff] shadow-xs
          border border-transparent rounded-[15px]
          hover:shadow-lg
        `}
      >
        {
          data.type !== BlockEnum.VariableAssigner && (
            <NodeTargetHandle
              id={id}
              data={data}
              handleClassName='!top-4 !-left-[9px]'
              handleId='target'
            />
          )
        }
        {
          data.type !== BlockEnum.IfElse && data.type !== BlockEnum.QuestionClassifier && (
            <NodeSourceHandle
              id={id}
              data={data}
              handleClassName='!top-4 !-right-[9px]'
              handleId='source'
            />
          )
        }
        <NodeControl
          id={id}
          data={data}
        />
        <div className='flex items-center px-3 pt-3 pb-2'>
          <BlockIcon
            className='shrink-0 mr-2'
            type={data.type}
            size='md'
            toolProviderId={data.provider_id}
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
    </div>
  )
}

export default memo(BaseNode)
