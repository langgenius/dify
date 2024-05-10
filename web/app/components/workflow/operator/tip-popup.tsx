import { memo } from 'react'
import ShortcutsName from '../shortcuts-name'
import TooltipPlus from '@/app/components/base/tooltip-plus'

type TipPopupProps = {
  title: string
  children: React.ReactNode
  shortcuts?: string[]
}
const TipPopup = ({
  title,
  children,
  shortcuts,
}: TipPopupProps) => {
  return (
    <TooltipPlus
      offset={4}
      hideArrow
      popupClassName='!p-0 !bg-gray-25'
      popupContent={
        <div className='flex items-center gap-1 px-2 h-6 text-xs font-medium text-gray-700 rounded-lg border-[0.5px] border-black/5'>
          {title}
          {
            shortcuts && <ShortcutsName keys={shortcuts} className='!text-[11px]' />
          }
        </div>
      }
    >
      {children}
    </TooltipPlus>
  )
}

export default memo(TipPopup)
