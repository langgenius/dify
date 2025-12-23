import { memo, useMemo } from 'react'
import { RiArrowRightSLine } from '@remixicon/react'
import BlockIcon from '@/app/components/workflow/block-icon'
import { NodeSourceHandle } from '../_base/components/node-handle'
import type { NodeProps } from '@/app/components/workflow/types'
import type { GroupHandler, GroupMember, GroupNodeData } from './types'
import type { BlockEnum } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'

const MAX_MEMBER_ICONS = 12

const GroupNode = (props: NodeProps<GroupNodeData>) => {
  const { data } = props

  // show the explicitly passed members first; otherwise use the _children information to fill the type
  const members: GroupMember[] = useMemo(() => (
    data.members?.length
      ? data.members
      : data._children?.length
        ? data._children.map(child => ({
          id: child.nodeId,
          type: child.nodeType as BlockEnum,
          label: child.nodeType,
        }))
        : []
  ), [data._children, data.members])

  // handler 列表：优先使用传入的 handlers，缺省时用 members 的 label 填充。
  const handlers: GroupHandler[] = useMemo(() => (
    data.handlers?.length
      ? data.handlers
      : members.length
        ? members.map(member => ({
          id: member.id,
          label: member.label || member.id,
        }))
        : []
  ), [data.handlers, members])

  return (
    <div className='space-y-2 px-3 pb-3'>
      {members.length > 0 && (
        <div className='flex items-center gap-1 overflow-hidden'>
          <div className='flex flex-wrap items-center gap-1 overflow-hidden'>
            {members.slice(0, MAX_MEMBER_ICONS).map(member => (
              <div
                key={member.id}
                className='flex h-7 items-center rounded-full bg-components-input-bg-normal px-1.5 shadow-xs'
              >
                <BlockIcon
                  type={member.type}
                  size='xs'
                  className='!shadow-none'
                />
              </div>
            ))}
            {members.length > MAX_MEMBER_ICONS && (
              <div className='system-xs-medium rounded-full bg-components-input-bg-normal px-2 py-1 text-text-tertiary'>
                +{members.length - MAX_MEMBER_ICONS}
              </div>
            )}
          </div>
          <RiArrowRightSLine className='ml-auto h-4 w-4 shrink-0 text-text-tertiary' />
        </div>
      )}
      {handlers.length > 0 && (
        <div className='space-y-1'>
          {handlers.map(handler => (
            <div
              key={handler.id}
              className={cn(
                'relative',
                'system-sm-semibold uppercase',
                'flex h-9 items-center rounded-md bg-components-panel-on-panel-item-bg px-3 text-text-primary shadow-xs',
              )}
            >
              {handler.label || handler.id}
              <NodeSourceHandle
                {...props}
                handleId={handler.id}
                handleClassName='!top-1/2 !-translate-y-1/2 !-right-[21px]'
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

GroupNode.displayName = 'GroupNode'

export default memo(GroupNode)
