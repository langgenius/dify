import type { FC, ReactNode } from 'react'
import type { ChatItem } from '../types'
import Avatar from './avatar'
import { AnswerTriangle } from '@/app/components/base/icons/src/vender/solid/general'

type AnswerProps = {
  item: ChatItem
  icon?: ReactNode
}
const Answer: FC<AnswerProps> = ({
  item,
  icon,
}) => {
  return (
    <div className='flex mb-2 last:mb-0 pr-10'>
      <Avatar className='shrink-0' />
      <div className='group relative ml-4'>
        <AnswerTriangle className='absolute -left-2 top-0 w-2 h-3 text-gray-100' />
        <div className='inline-block px-4 py-3 bg-gray-100 rounded-b-2xl rounded-tr-2xl text-sm text-gray-900'>
          {item.content}
        </div>
        <div className='flex items-center mt-1 h-[18px] text-xs text-gray-400 opacity-0 group-hover:opacity-100'>
          <div className='mr-2'>5.6s</div>
          <div className='turncate'>Tokens spent 200</div>
          <div className='mx-2'>·</div>
          <div>1:20 PM</div>
        </div>
      </div>
    </div>
  )
}

export default Answer
