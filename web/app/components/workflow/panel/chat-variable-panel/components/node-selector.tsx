'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import {
  useNodes,
} from 'reactflow'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type {
  CommonNodeType,
} from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

type Props = {
  value: boolean
  onChange: (value: boolean) => void
  nodeType?: BlockEnum
}

const NodeSelector: FC<Props> = ({
  value,
  onChange,
  nodeType = BlockEnum.LLM,
}) => {
  const [open, setOpen] = useState(false)
  const nodes = useNodes<CommonNodeType>()

  const filteredNodes = nodeType ? nodes.filter(node => node.data?.type === nodeType) : nodes

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <span>Select Node</span>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[25]'>
        <div className='rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1 shadow-lg'>
          {filteredNodes.map(node => (
            <div key={node.id} className=''>
              {node.data?.title}
            </div>
          ))}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(NodeSelector)
