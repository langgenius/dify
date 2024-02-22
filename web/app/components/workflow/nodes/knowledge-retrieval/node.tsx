import type { FC } from 'react'
import { Folder } from '@/app/components/base/icons/src/vender/solid/files'

const Node: FC = () => {
  return (
    <div className='px-3'>
      <div className='space-y-0.5'>
        {['product Doc', 'Text completion'].map(name => (
          <div key={name} className='flex items-center h-[26px] bg-gray-100 rounded-md  px-1 text-xs font-normal text-gray-700'>
            <div className='mr-1 shrink-0 p-1 bg-[#F5F8FF] rounded-md border-[0.5px] border-[#E0EAFF]'>
              <Folder className='w-3 h-3 text-[#444CE7]' />
            </div>
            <div className='text-xs font-normal text-gray-700'>
              {name}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Node
