'use client'

import type { FC } from 'react'
import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import { Plus02 } from '@/app/components/base/icons/src/vender/line/general'
import type { CustomGroupNodeData } from './types'
import { cn } from '@/utils/classnames'

type CustomGroupNodeProps = {
  id: string
  data: CustomGroupNodeData
}

const CustomGroupNode: FC<CustomGroupNodeProps> = ({ data }) => {
  const { group } = data
  const exitPorts = group.exitPorts ?? []
  const connectedSourceHandleIds = data._connectedSourceHandleIds ?? []

  return (
    <div
      className={cn(
        'bg-workflow-block-parma-bg/50 group relative rounded-2xl border-2 border-dashed border-components-panel-border',
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
        className={cn(
          '!h-4 !w-4 !rounded-none !border-none !bg-transparent !outline-none',
          'after:absolute after:left-1.5 after:top-1 after:h-2 after:w-0.5 after:bg-workflow-link-line-handle',
          'transition-all hover:scale-125',
        )}
        style={{ top: '50%' }}
      />

      <div className="px-3 pt-3">
        {exitPorts.map((port, index) => {
          const connected = connectedSourceHandleIds.includes(port.portNodeId)

          return (
            <div key={port.portNodeId} className="relative flex h-6 items-center px-1">
              <div className="w-full text-right text-xs font-semibold text-text-secondary">
                {port.name}
              </div>

              <Handle
                id={port.portNodeId}
                type="source"
                position={Position.Right}
                className={cn(
                  'group/handle z-[1] !h-4 !w-4 !rounded-none !border-none !bg-transparent !outline-none',
                  'after:absolute after:right-1.5 after:top-1 after:h-2 after:w-0.5 after:bg-workflow-link-line-handle',
                  'transition-all hover:scale-125',
                  !connected && 'after:opacity-0',
                  '!-right-[21px] !top-1/2 !-translate-y-1/2',
                )}
                isConnectable
              />

              {/* Visual "+" indicator (styling aligned with existing branch handles) */}
              <div
                className={cn(
                  'pointer-events-none absolute z-10 hidden h-4 w-4 items-center justify-center rounded-full bg-components-button-primary-bg text-text-primary-on-surface',
                  '-right-[21px] top-1/2 -translate-y-1/2',
                  'group-hover:flex',
                  data.selected && '!flex',
                )}
              >
                <Plus02 className="h-2.5 w-2.5" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default memo(CustomGroupNode)
