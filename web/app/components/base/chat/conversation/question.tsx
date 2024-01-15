import type {
  FC,
  ReactNode,
} from 'react'
import type { ChatItem } from '../types'
import { QuestionTriangle } from '@/app/components/base/icons/src/vender/solid/general'
import { User } from '@/app/components/base/icons/src/public/avatar'

type QuestionProps = {
  item: ChatItem
  icon?: ReactNode
}
const Question: FC<QuestionProps> = ({
  item,
  icon,
}) => {
  return (
    <div className='flex justify-end mb-2 last:mb-0 pl-10'>
      <div className='relative mr-4'>
        <QuestionTriangle className='absolute -right-2 top-0 w-2 h-3 text-[#D1E9FF]/50' />
        <div className='px-4 py-3 bg-[#D1E9FF]/50 rounded-b-2xl rounded-tl-2xl text-sm text-gray-900'>
          {item.content}
        </div>
        <div className='mt-1 h-[18px]' />
      </div>
      <div className='shrink-0 w-10 h-10'>
        {
          icon || (
            <div className='w-full h-full rounded-full border-[0.5px] border-black/5'>
              <User className='w-full h-full' />
            </div>
          )
        }
      </div>
    </div>
  )
}

export default Question
