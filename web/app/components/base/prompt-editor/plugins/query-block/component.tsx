import type { FC } from 'react'
import { useSelectOrDelete } from '../../hooks'
import { UserEdit02 } from '@/app/components/base/icons/src/vender/solid/users'

type QueryBlockComponentProps = {
  nodeKey: string
}

const QueryBlockComponent: FC<QueryBlockComponentProps> = ({
  nodeKey,
}) => {
  const [ref, isSelected] = useSelectOrDelete(nodeKey)

  return (
    <div
      className={`
        inline-flex items-center pl-1 pr-0.5 h-6 bg-[#FFF6ED] border border-transparent rounded-[5px] hover:bg-[#FFEAD5]
        ${isSelected && '!border-[#FD853A]'}
      `}
      ref={ref}
    >
      <UserEdit02 className='mr-1 w-[14px] h-[14px] text-[#FD853A]' />
      <div className='text-xs font-medium text-[#EC4A0A] opacity-60'>{'{{'}</div>
      <div className='text-xs font-medium text-[#EC4A0A]'>query</div>
      <div className='text-xs font-medium text-[#EC4A0A] opacity-60'>{'}}'}</div>
    </div>
  )
}

export default QueryBlockComponent
