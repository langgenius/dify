import { useState } from 'react'
import { RiFilter3Line } from '@remixicon/react'
import MetadataPanel from './metadata-panel'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'

const MetadataTrigger = ({
  metadataFilteringConditions,
  ...restProps
}: MetadataShape) => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      placement='left'
      offset={4}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(!open)}>
        <Button
          variant='secondary-accent'
          size='small'
        >
          <RiFilter3Line className='mr-1 w-3.5 h-3.5' />
          Conditions
          <div className='flex items-center ml-1 px-1 rounded-[5px] border border-divider-deep system-2xs-medium-uppercase text-text-tertiary'>
            {metadataFilteringConditions?.conditions.length || 0}
          </div>
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <MetadataPanel
          metadataFilteringConditions={metadataFilteringConditions}
          onCancel={() => setOpen(false)}
          {...restProps}
        />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default MetadataTrigger
