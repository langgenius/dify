import { memo } from 'react'
import cn from 'classnames'
import { getKeyboardKeyNameBySystem } from './utils'

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
      'flex items-center gap-0.5 h-4 text-xs text-gray-400',
      className,
    )}>
      {
        keys.map(key => (
          <div
            key={key}
            className='capitalize'
          >
            {getKeyboardKeyNameBySystem(key)}
          </div>
        ))
      }
    </div>
  )
}

export default memo(ShortcutsName)
