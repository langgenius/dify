import type {
  FC,
  ReactNode,
} from 'react'
import {
  memo,
} from 'react'
import type { ChatItem } from '../types'
import type { Theme } from '../embedded-chatbot/theme/theme-context'
import { CssTransform } from '../embedded-chatbot/theme/utils'
import { User } from '@/app/components/base/icons/src/public/avatar'
import { Markdown } from '@/app/components/base/markdown'
import { FileList } from '@/app/components/base/file-uploader'

interface QuestionProps {
  item: ChatItem
  questionIcon?: ReactNode
  theme: Theme | null | undefined
}
const Question: FC<QuestionProps> = ({
  item,
  questionIcon,
  theme,
}) => {
  const {
    content,
    message_files,
  } = item

  return (
    <div className='mb-2 flex justify-end pl-14 last:mb-0'>
      <div className='group relative mr-4 max-w-full'>
        <div
          className='rounded-2xl bg-[#D1E9FF]/50 px-4 py-3 text-sm text-gray-900'
          style={theme?.chatBubbleColorStyle ? CssTransform(theme.chatBubbleColorStyle) : {}}
        >
          {
            !!message_files?.length && (
              <FileList
                files={message_files}
                showDeleteAction={false}
                showDownloadAction={true}
              />
            )
          }
          <Markdown content={content} />
        </div>
        <div className='mt-1 h-[18px]' />
      </div>
      <div className='h-10 w-10 shrink-0'>
        {
          questionIcon || (
            <div className='h-full w-full rounded-full border-[0.5px] border-black/5'>
              <User className='h-full w-full' />
            </div>
          )
        }
      </div>
    </div>
  )
}

export default memo(Question)
