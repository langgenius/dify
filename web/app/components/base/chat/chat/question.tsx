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
import ContentSwitch from './content-switch'
import { User } from '@/app/components/base/icons/src/public/avatar'
import { Markdown } from '@/app/components/base/markdown'
import { FileList } from '@/app/components/base/file-uploader'

interface QuestionProps {
  item: ChatItem
  questionIcon?: ReactNode
  theme: Theme | null | undefined
  switchSibling?: (siblingMessageId: string) => void
}
const Question: FC<QuestionProps> = ({
  item,
  questionIcon,
  theme,
  switchSibling,
}) => {
  const {
    content,
    message_files,
  } = item

  return (
    <div className='flex justify-end mb-2 last:mb-0 pl-14'>
      <div className='group relative mr-4 max-w-full'>
        <div
          className='px-4 py-3 bg-[#D1E9FF]/50 rounded-2xl text-sm text-gray-900'
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
          {/* {item.siblingCount && item.siblingCount > 1 && item.siblingIndex !== undefined && <div className="pt-3.5 flex justify-center items-center text-sm">
              <button
                className={`${item.prevSibling ? 'opacity-100' : 'opacity-30'}`}
                disabled={!item.prevSibling}
                onClick={() => item.prevSibling && switchSibling?.(item.prevSibling)}
              >
                <ChevronRight className="w-[14px] h-[14px] rotate-180 text-text-primary" />
              </button>
              <span className="px-2 text-xs text-text-primary">{item.siblingIndex + 1} / {item.siblingCount}</span>
              <button
                className={`${item.nextSibling ? 'opacity-100' : 'opacity-30'}`}
                disabled={!item.nextSibling}
                onClick={() => item.nextSibling && switchSibling?.(item.nextSibling)}
              >
                <ChevronRight className="w-[14px] h-[14px] text-text-primary" />
              </button>
            </div>} */}
          <ContentSwitch
            count={item.siblingCount}
            currentIndex={item.siblingIndex}
            prevDisabled={!item.prevSibling}
            nextDisabled={!item.nextSibling}
            switchSibling={direction => switchSibling?.(direction === 'prev' ? item.prevSibling : item.nextSibling)}
          />
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
