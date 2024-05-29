'use client'
import type { FC } from 'react'
import React, { useRef } from 'react'
import { useContext } from 'use-context-selector'
import s from '../style.module.css'
import type { IChatItem } from '../type'
import MoreInfo from '../more-info'
import AppContext from '@/context/app-context'
import { Markdown } from '@/app/components/base/markdown'
import ImageGallery from '@/app/components/base/image-gallery'
import type { ThemeBuilder } from '@/app/components/share/chatbot/theme/theme-context'
import { CssTransform } from '@/app/components/share/chatbot/theme/utils'

type IQuestionProps = Pick<IChatItem, 'id' | 'content' | 'more' | 'useCurrentUserAvatar'> & {
  isShowPromptLog?: boolean
  item: IChatItem
  isResponding?: boolean
  theme?: ThemeBuilder
}

const Question: FC<IQuestionProps> = ({ id, content, more, useCurrentUserAvatar, isShowPromptLog, item, theme }) => {
  const { userProfile } = useContext(AppContext)
  const userName = userProfile?.name
  const ref = useRef(null)
  const imgSrcs = item.message_files?.map(item => item.url)

  return (
    <div className={`flex items-start justify-end ${isShowPromptLog && 'first-of-type:pt-[14px]'}`} key={id} ref={ref}>
      <div className={s.questionWrapWrap}>
        <div className={`${s.question} group relative text-sm text-gray-900`}>
          <svg width="8" height="12" viewBox="0 0 8 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', right: '0' }}>
            <path d="M6.96353 1.5547C7.40657 0.890144 6.93018 0 6.13148 0H0V12L6.96353 1.5547Z" fill={theme?.theme?.chatBubbleColor ?? '#E1EFFE'}/>
          </svg>
          <div
            className={'mr-2 py-3 px-4 bg-blue-500 rounded-tl-2xl rounded-b-2xl'}
            style={theme?.theme?.chatBubbleColorStyle ? CssTransform(theme.theme.chatBubbleColorStyle) : {}}
          >
            {imgSrcs && imgSrcs.length > 0 && (
              <ImageGallery srcs={imgSrcs} />
            )}
            <Markdown content={content} />
          </div>
        </div>
        {more && <MoreInfo more={more} isQuestion={true} />}
      </div>
      {useCurrentUserAvatar
        ? (
          <div className='w-10 h-10 shrink-0 leading-10 text-center mr-2 rounded-full bg-primary-600 text-white'>
            {userName?.[0].toLocaleUpperCase()}
          </div>
        )
        : (
          <div className={`${s.questionIcon} w-10 h-10 shrink-0 `}></div>
        )}
    </div>
  )
}
export default React.memo(Question)
