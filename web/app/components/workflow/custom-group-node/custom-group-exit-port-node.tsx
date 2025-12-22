'use client'

import type { FC } from 'react'
import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import type { CustomGroupExitPortNodeData } from './types'
import cn from '@/utils/classnames'

type CustomGroupExitPortNodeProps = {
  id: string
  data: CustomGroupExitPortNodeData
}

const CustomGroupExitPortNode: FC<CustomGroupExitPortNodeProps> = ({ id: _id, data }) => {
  return (
    <div
      className={cn(
        'flex items-center justify-center',
        'h-8 w-8 rounded-full',
        'bg-util-colors-green-green-500 shadow-md',
        data.selected && 'ring-2 ring-primary-400',
      )}
    >
      {/* Target handle - receives internal connections from leaf nodes */}
      <Handle
        id="target"
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-white"
      />

      {/* Source handle - connects to external nodes */}
      <Handle
        id="source"
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-white"
      />

      {/* Icon */}
      <svg
        className="h-4 w-4 text-white"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M5 12h14M12 5l7 7-7 7" />
      </svg>
    </div>
  )
}

export default memo(CustomGroupExitPortNode)
