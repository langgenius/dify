import { memo } from 'react'
import ShortcutsName from '../shortcuts-name'
import Tooltip from '@/app/components/base/tooltip'

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
    <Tooltip
      offset={4}
      popupClassName='p-0 bg-transparent'
      popupContent={
        <div className='border-components-panel-border bg-components-tooltip-bg flex items-center gap-1 rounded-lg border-[0.5px] p-1.5 shadow-lg backdrop-blur-[5px]'>
          <span className='system-xs-medium text-text-secondary'>{title}</span>
          {
            shortcuts && <ShortcutsName keys={shortcuts} />
          }
        </div>
      }
    >
      {children}
    </Tooltip>
  )
}

export default memo(TipPopup)
