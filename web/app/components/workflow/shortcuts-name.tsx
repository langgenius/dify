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
            className='bg-components-kbd-bg-gray system-kbd flex h-4 w-4 items-center justify-center rounded-[4px] capitalize'
          >
            {getKeyboardKeyNameBySystem(key)}
          </div>
        ))
      }
    </div>
  )
}

export default memo(ShortcutsName)
