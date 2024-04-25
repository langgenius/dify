import type {
  FC,
  ReactNode,
} from 'react'
import {
  memo,
} from 'react'
import type { ChatItem } from '../types'
import { QuestionTriangle } from '@/app/components/base/icons/src/vender/solid/general'
import { User } from '@/app/components/base/icons/src/public/avatar'
import { Markdown } from '@/app/components/base/markdown'
import ImageGallery from '@/app/components/base/image-gallery'

type QuestionProps = {
  item: ChatItem
  questionIcon?: ReactNode
}
const Question: FC<QuestionProps> = ({
  item,
  questionIcon,
}) => {
  const {
    content,
    message_files,
  } = item

  const imgSrcs = message_files?.length ? message_files.map(item => item.url) : []

  return (
    <div className='flex justify-end mb-2 last:mb-0 pl-10'>
      <div className='group relative mr-4'>
        <QuestionTriangle className='absolute -right-2 top-0 w-2 h-3 text-[#D1E9FF]/50' />
        <div className='px-4 py-3 bg-[#D1E9FF]/50 rounded-b-2xl rounded-tl-2xl text-sm text-gray-900'>
          {
            !!imgSrcs.length && (
              <ImageGallery srcs={imgSrcs} />
            )
          }
          <Markdown content={content} />
        </div>
        <div className='mt-1 h-[18px]' />
      </div>
      <div className='shrink-0 w-10 h-10'>
        {
          questionIcon || (
            <div className='w-full h-full rounded-full border-[0.5px] border-black/5'>
              <User className='w-full h-full' />
            </div>
          )
        }
      </div>
    </div>
  )
}

export default memo(Question)
