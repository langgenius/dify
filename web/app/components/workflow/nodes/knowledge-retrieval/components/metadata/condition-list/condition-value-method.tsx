import { useState } from 'react'
import { capitalize } from 'lodash-es'
import { RiArrowDownSLine } from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'

export type ConditionValueMethodProps = {
  valueMethod?: string
  onValueMethodChange: (v: string) => void
}
const options = [
  'variable',
  'constant',
]
const ConditionValueMethod = ({
  valueMethod = 'variable',
  onValueMethodChange,
}: ConditionValueMethodProps) => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={{ mainAxis: 4, crossAxis: 0 }}
    >
      <PortalToFollowElemTrigger asChild onClick={() => setOpen(v => !v)}>
        <Button
          className='shrink-0'
          variant='ghost'
          size='small'
        >
          {capitalize(valueMethod)}
          <RiArrowDownSLine className='ml-[1px] h-3.5 w-3.5' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className='w-[112px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg'>
          {
            options.map(option => (
              <div
                key={option}
                className={cn(
                  'flex h-7 cursor-pointer items-center rounded-md px-3 hover:bg-state-base-hover',
                  'text-[13px] font-medium text-text-secondary',
                  valueMethod === option && 'bg-state-base-hover',
                )}
                onClick={() => {
                  if (valueMethod === option)
                    return
                  onValueMethodChange(option)
                  setOpen(false)
                }}
              >
                {capitalize(option)}
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ConditionValueMethod
