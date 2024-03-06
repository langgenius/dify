import type {
  FC,
  ReactElement,
} from 'react'
import {
  cloneElement,
  memo,
} from 'react'
import type { NodeProps } from '../../types'
import { BlockEnum } from '@/app/components/workflow/types'
import BlockIcon from '@/app/components/workflow/block-icon'
import AppIcon from '@/app/components/base/app-icon'

type BaseNodeProps = {
  children: ReactElement
} & NodeProps

const BaseNode: FC<BaseNodeProps> = ({
  id,
  data,
  children,
}) => {
  const type = data.type

  return (
    <div
      className={`
        group relative w-[240px] bg-[#fcfdff] rounded-2xl shadow-xs
        hover:shadow-lg
        ${data._selected ? 'border-[2px] border-primary-600' : 'border border-white'}
      `}
    >
      <div className='flex items-center px-3 pt-3 pb-2'>
        {
          type !== BlockEnum.Tool && (
            <BlockIcon
              className='shrink-0 mr-2'
              type={data.type}
              size='md'
            />
          )
        }
        {
          type === BlockEnum.Tool && (
            <>
              {
                typeof data._icon === 'string'
                  ? (
                    <div
                      className='shrink-0 mr-2 w-6 h-6 bg-cover bg-center rounded-md'
                      style={{
                        backgroundImage: `url(${data._icon})`,
                      }}
                    ></div>
                  )
                  : (
                    <AppIcon
                      className='shrink-0 mr-2'
                      size='tiny'
                      icon={data._icon?.content}
                      background={data._icon?.background}
                    />
                  )
              }
            </>
          )
        }
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
