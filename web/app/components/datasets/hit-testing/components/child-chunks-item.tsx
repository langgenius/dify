'use client'
import type { FC } from 'react'
import React from 'react'
import { SliceContent } from '../../formatted-text/flavours/shared'
import Score from './score'
import type { HitTestingChildChunk } from '@/models/datasets'

type Props = {
  payload: HitTestingChildChunk
  isShowAll: boolean
}

const ChildChunks: FC<Props> = ({
  payload,
  isShowAll,
}) => {
  const { id, score, content, position } = payload
  return (
    <div
      className={!isShowAll ? 'line-clamp-2 break-all' : ''}
    >
      <div className='relative top-[-2px] inline-flex items-center'>
        <div className='bg-state-accent-solid system-2xs-semibold-uppercase text-text-primary-on-surface flex  h-[20.5px] items-center px-1'>C-{position}</div>
        <Score value={score} besideChunkName />
      </div>
      <SliceContent className='bg-state-accent-hover group-hover:bg-state-accent-hover text-text-secondary py-0.5 text-sm font-normal'>{content}</SliceContent>
    </div>
  )
}
export default React.memo(ChildChunks)
