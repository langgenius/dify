import { useState } from 'react'
import {
  RiAddLine,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'

const AddCondition = ({
  handleAddCondition,
}: Pick<MetadataShape, 'handleAddCondition'>) => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={{
        mainAxis: 3,
        crossAxis: 0,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(!open)}>
        <Button
          size='small'
          variant='secondary'
        >
          <RiAddLine className='w-3.5 h-3.5' />
          Add Condition
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='w-[320px] bg-components-panel-bg-blur border-[0.5px] border-components-panel-border rounded-xl shadow-lg'>
          <div className='p-2 pb-1'>
            <Input
              showLeftIcon
              placeholder='Search metadata'
            />
          </div>
          <div className='p-1'>
            <div className='flex items-center px-3 h-6 rounded-md system-sm-medium text-text-secondary cursor-pointer hover:bg-state-base-hover'>
              <div
                className='grow truncate'
                title='Language'
                onClick={() => handleAddCondition?.('language')}
              >
                Language
              </div>
              <div className='shrink-0 system-xs-regular text-text-tertiary'>string</div>
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default AddCondition
