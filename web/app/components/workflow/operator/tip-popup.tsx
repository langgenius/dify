import type { ReactElement } from 'react'
import { memo } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/base/ui/popover'
import ShortcutsName from '../shortcuts-name'

type TipPopupProps = {
  title: string
  children: ReactElement
  shortcuts?: string[]
}
const TipPopup = ({
  title,
  children,
  shortcuts,
}: TipPopupProps) => {
  return (
    <Popover>
      <PopoverTrigger openOnHover nativeButton={false} render={children} />
      <PopoverContent placement="top" sideOffset={4} popupClassName="border-none bg-transparent p-0 shadow-none">
        <div className="flex items-center gap-1 rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg p-1.5 shadow-lg backdrop-blur-[5px]">
          <span className="text-text-secondary system-xs-medium">{title}</span>
          {
            shortcuts && <ShortcutsName keys={shortcuts} />
          }
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default memo(TipPopup)
