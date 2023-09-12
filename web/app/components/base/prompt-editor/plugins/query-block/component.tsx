import { UserEdit02 } from '@/app/components/base/icons/src/vender/solid/users'

const QueryBlockComponent = () => {
  return (
    <div className='inline-flex items-center pl-1 pr-0.5 h-6 bg-[#FFF6ED] border border-transparent rounded-[5px] hover:bg-[#FFEAD5]'>
      <UserEdit02 className='mr-1 w-[14px] h-[14px] text-[#FD853A]' />
      <div className='text-xs font-medium text-[#EC4A0A] opacity-60'>{'{{'}</div>
      <div className='text-xs font-medium text-[#EC4A0A]'>query</div>
      <div className='text-xs font-medium text-[#EC4A0A] opacity-60'>{'}}'}</div>
    </div>
  )
}

export default QueryBlockComponent
