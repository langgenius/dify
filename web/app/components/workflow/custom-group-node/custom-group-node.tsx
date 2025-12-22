'use client'

import type { FC } from 'react'
import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import type { CustomGroupNodeData } from './types'
import { cn } from '@/utils/classnames'

type CustomGroupNodeProps = {
  id: string
  data: CustomGroupNodeData
}

const CustomGroupNode: FC<CustomGroupNodeProps> = ({ id: _id, data }) => {
  const { group } = data

  return (
    <div
      className={cn(
        'bg-workflow-block-parma-bg/50 relative rounded-2xl border-2 border-dashed border-components-panel-border',
        data.selected && 'border-primary-400',
      )}
      style={{
        width: data.width || 280,
        height: data.height || 200,
      }}
    >
      {/* Group Header */}
      <div className="absolute -top-7 left-0 flex items-center gap-1 px-2">
        <span className="text-xs font-medium text-text-tertiary">
          {group.title}
        </span>
      </div>

      {/* Target handle for incoming connections */}
      <Handle
        id="target"
        type="target"
        position={Position.Left}
        className="!h-4 !w-4 !border-2 !border-white !bg-primary-500"
        style={{ top: '50%' }}
      />

      {/* Source handles will be rendered by exit port nodes */}
    </div>
  )
}

export default memo(CustomGroupNode)
