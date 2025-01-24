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
      <div className='inline-flex items-center relative top-[-2px]'>
        <div className='flex items-center h-[20.5px] bg-state-accent-solid  system-2xs-semibold-uppercase text-text-primary-on-surface px-1'>C-{position}</div>
        <Score value={score} besideChunkName />
      </div>
      <SliceContent className='py-0.5 bg-state-accent-hover group-hover:bg-state-accent-hover text-sm text-text-secondary font-normal'>{content}</SliceContent>
    </div>
  )
}
export default React.memo(ChildChunks)
