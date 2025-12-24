'use client'
import type { FC } from 'react'
import type { HitTestingChildChunk } from '@/models/datasets'
import * as React from 'react'
import { SliceContent } from '../../formatted-text/flavours/shared'
import Score from './score'

type Props = {
  payload: HitTestingChildChunk
  isShowAll: boolean
}

const ChildChunks: FC<Props> = ({
  payload,
  isShowAll,
}) => {
  const { score, content, position } = payload
  return (
    <div
      className={!isShowAll ? 'line-clamp-2 break-all' : ''}
    >
      <div className="relative top-[-2px] inline-flex items-center">
        <div className="system-2xs-semibold-uppercase flex h-[20.5px] items-center  bg-state-accent-solid px-1 text-text-primary-on-surface">
          C-
          {position}
        </div>
        <Score value={score} besideChunkName />
      </div>
      <SliceContent className="bg-state-accent-hover py-0.5 text-sm font-normal text-text-secondary group-hover:bg-state-accent-hover">{content}</SliceContent>
    </div>
  )
}
export default React.memo(ChildChunks)
