'use client'
import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import {
  RiArrowDownSLine,
  RiCheckLine,
} from '@remixicon/react'
import { useShallow } from 'zustand/react/shallow'
import {
  useStore,
} from 'reactflow'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type Props = {
  value: string
  onChange: (value: string) => void
  nodeType?: BlockEnum
}

const NodeSelector: FC<Props> = ({
  value,
  onChange,
  nodeType = BlockEnum.LLM,
}) => {
  const [open, setOpen] = useState(false)

  const filteredNodes = useStore(useShallow((s) => {
    const nodes = [...s.nodeInternals.values()]
    return nodes.filter(node => node.data?.type === nodeType)
  }))

  const currentNode = useMemo(() => filteredNodes.find(node => node.id === value), [filteredNodes, value])
  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        {currentNode && (
          <div className={cn('flex h-8 w-[208px] cursor-pointer items-center gap-1 rounded-lg bg-components-input-bg-normal px-2 py-1 pl-3 hover:bg-state-base-hover-alt', open && 'bg-state-base-hover-alt')}>{currentNode.data?.title}</div>
        )}
        {!currentNode && (
          <div className={cn('flex h-8 w-[208px] cursor-pointer items-center gap-1 rounded-lg bg-components-input-bg-normal px-2 py-1 pl-3 hover:bg-state-base-hover-alt', open && 'bg-state-base-hover-alt')}>
            <div className='system-sm-regular grow truncate text-components-input-text-placeholder'>Select node...</div>
            <RiArrowDownSLine className='h-4 w-4 text-text-quaternary' />
          </div>
        )}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[25]'>
        <div className='w-[209px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1 shadow-lg'>
          {filteredNodes.map(node => (
            <div key={node.id} className='flex cursor-pointer items-center rounded-lg px-2 py-1 hover:bg-state-base-hover' onClick={() => onChange(node.id)}>
              <BlockIcon className={cn('mr-2 shrink-0')} type={node.data?.type} />
              <div className='system-sm-medium grow text-text-secondary'>{node.data?.title}</div>
              {currentNode?.id === node.id && (
                <RiCheckLine className='h-4 w-4 shrink-0 text-text-accent' />
              )}
            </div>
          ))}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(NodeSelector)
