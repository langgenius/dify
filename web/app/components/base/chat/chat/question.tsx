import type { FC, ReactNode } from 'react'
import { memo } from 'react'
import type { ChatItem } from '../types'
import type { Theme } from '../embedded-chatbot/theme/theme-context'
import { CssTransform } from '../embedded-chatbot/theme/utils'
import { useChatWithHistoryContext } from '../chat-with-history/context'
import { QuestionTriangle } from '@/app/components/base/icons/src/vender/solid/general'
import { User } from '@/app/components/base/icons/src/public/avatar'
import { Markdown } from '@/app/components/base/markdown'
import ImageGallery from '@/app/components/base/image-gallery'

type QuestionProps = {
  item: ChatItem
  questionIcon?: ReactNode
  theme: Theme | null | undefined
}
const Question: FC<QuestionProps> = ({ item, questionIcon, theme }) => {
  const { isMobile } = useChatWithHistoryContext()
  const { content, message_files } = item

  const imgSrcs = message_files?.length
    ? message_files.map(item => item.url)
    : []

  const renderContent = () => (
    <div
      className="px-4 py-3 bg-[#D1E9FF]/50 rounded-b-2xl rounded-tl-2xl text-sm text-gray-900"
      style={
        theme?.chatBubbleColorStyle
          ? CssTransform(theme.chatBubbleColorStyle)
          : {}
      }
    >
      {!!imgSrcs.length && <ImageGallery srcs={imgSrcs} />}
      <Markdown content={content} />
    </div>
  )

  const renderQuestionIcon = () => (
    <div className="shrink-0 w-10 h-10">
      {questionIcon || (
        <div className="w-full h-full rounded-full border-[0.5px] border-black/5">
          <User className="w-full h-full" />
        </div>
      )}
    </div>
  )

  return (
    <div
      className={`flex ${
        isMobile ? 'flex-col-reverse items-end' : 'justify-end pl-10'
      } mb-2 last:mb-0 `}
    >
      <div className={`group relative ${isMobile ? 'mt-4' : 'mr-4'} `}>
        <QuestionTriangle
          className={`absolute w-2 h-3 text-[#D1E9FF]/50 ${
            isMobile ? 'right-0 -top-2 rotate-180' : '-right-2 top-0 '
          }`}
          style={theme ? { color: theme.chatBubbleColor } : {}}
        />
        {renderContent()}
        <div className="mt-1 h-[18px]" />
      </div>
      {renderQuestionIcon()}
    </div>
  )
}

export default memo(Question)
