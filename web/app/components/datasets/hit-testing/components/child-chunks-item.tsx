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
  const { id, score, content } = payload
  return (
    <div
      className={!isShowAll ? 'line-clamp-2' : ''}
    >
      <div className='inline-flex'>
        <div className='bg-state-accent-solid system-2xs-semibold-uppercase px-1'>C-{id}</div>
        <Score value={score} />
      </div>
      <SliceContent className='bg-state-accent-hover group-hover:bg-state-accent-hover'>{content}</SliceContent>
    </div>
  )
}
export default React.memo(ChildChunks)
