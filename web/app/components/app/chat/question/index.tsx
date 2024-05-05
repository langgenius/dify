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
import VideoGallery from '@/app/components/base/video-gallery'

type IQuestionProps = Pick<IChatItem, 'id' | 'content' | 'more' | 'useCurrentUserAvatar'> & {
  isShowPromptLog?: boolean
  item: IChatItem
  isResponding?: boolean
}

const Question: FC<IQuestionProps> = ({ id, content, more, useCurrentUserAvatar, isShowPromptLog, item }) => {
  const { userProfile } = useContext(AppContext)
  const userName = userProfile?.name
  const ref = useRef(null)
  const mediaSrcs = item.message_files?.map(item => item.url)
  const mediaType = item.message_files?.map(item => item.type)[0] || ''

  return (
    <div className={`flex items-start justify-end ${isShowPromptLog && 'first-of-type:pt-[14px]'}`} key={id} ref={ref}>
      <div className={s.questionWrapWrap}>

        <div className={`${s.question} group relative text-sm text-gray-900`}>
          <div className={'mr-2 py-3 px-4 bg-blue-500 rounded-tl-2xl rounded-b-2xl'}>
            {mediaSrcs?.length && mediaType === 'image' && (<ImageGallery srcs={mediaSrcs} />)}
            {mediaSrcs?.length && mediaType === 'video' && (<VideoGallery srcs={mediaSrcs} />)}
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
