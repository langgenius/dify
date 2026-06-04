import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiInfoI } from '@remixicon/react'
import * as React from 'react'

type TooltipProps = {
  content: string
}

const Tooltip = ({
  content,
}: TooltipProps) => {
  if (!content)
    return null
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={0}
        closeDelay={0}
        aria-label={content}
        className="group relative z-10 flex size-[18px] items-center justify-center rounded-sm border-0 bg-state-base-hover p-0 transition-[border-radius,background-color] duration-500 ease-in-out hover:rounded-none hover:bg-saas-dify-blue-static"
      >
        <RiInfoI className="size-3.5 text-text-tertiary group-hover:text-text-primary-on-surface" data-testid="tooltip-icon" />
      </PopoverTrigger>
      <PopoverContent placement="top-end" popupClassName="w-[260px] rounded-none border-0 bg-saas-dify-blue-static px-5 py-[18px] system-xs-regular text-text-primary-on-surface shadow-none">
        {content}
      </PopoverContent>
    </Popover>
  )
}

export default React.memo(Tooltip)
