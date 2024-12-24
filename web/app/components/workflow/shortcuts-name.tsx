import { memo } from 'react'
import { getKeyboardKeyNameBySystem } from './utils'
import cn from '@/utils/classnames'

type ShortcutsNameProps = {
  keys: string[]
  className?: string
}
const ShortcutsName = ({
  keys,
  className,
}: ShortcutsNameProps) => {
  return (
    <div className={cn(
      'flex items-center gap-0.5',
      className,
    )}>
      {
        keys.map(key => (
          <div
            key={key}
            className='w-4 h-4 flex items-center justify-center bg-components-kbd-bg-gray rounded-[4px] system-kbd capitalize'
          >
            {getKeyboardKeyNameBySystem(key)}
          </div>
        ))
      }
    </div>
  )
}

export default memo(ShortcutsName)
