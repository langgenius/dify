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
            className='system-kbd flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray capitalize'
          >
            {getKeyboardKeyNameBySystem(key)}
          </div>
        ))
      }
    </div>
  )
}

export default memo(ShortcutsName)
