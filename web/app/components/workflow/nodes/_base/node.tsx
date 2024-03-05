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
