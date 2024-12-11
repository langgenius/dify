'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { SliceContent, SliceLabel } from '../../formatted-text/flavours/shared'
import cn from '@/utils/classnames'
import type { HitTestingChildChunk } from '@/models/datasets'

type Props = {
  payload: HitTestingChildChunk
  isShowAll: boolean
}

const ChildChunks: FC<Props> = ({
  payload,
  isShowAll,
}) => {
  const { t } = useTranslation()
  const { id, score, content } = payload
  return (
    <div className='flex items-center space-x-2'>
      <SliceLabel>
        {id} {score}
      </SliceLabel>
      <SliceContent className={cn(!isShowAll && 'line-clamp-2')}>
        {content}
      </SliceContent>
    </div>
  )
}
export default React.memo(ChildChunks)
