'use client'
import type { FC } from 'react'
import type { SubGraphCanvasProps } from './types'
import { memo } from 'react'
import SubGraph from '@/app/components/sub-graph'

const SubGraphCanvas: FC<SubGraphCanvasProps> = (props) => {
  return (
    <div className="h-full w-full">
      <SubGraph {...props} />
    </div>
  )
}

export default memo(SubGraphCanvas)
