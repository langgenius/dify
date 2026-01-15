import { memo } from 'react'
import { cn } from '@/utils/classnames'
import { getKeyboardKeyNameBySystem } from './utils'

type ShortcutsNameProps = {
  keys: string[]
  className?: string
  textColor?: 'default' | 'secondary'
}
const ShortcutsName = ({
  keys,
  className,
  textColor = 'default',
}: ShortcutsNameProps) => {
  return (
    <div className={cn(
      'flex items-center gap-0.5',
      className,
    )}
    >
      {
        keys.map(key => (
          <div
            key={key}
            className={cn(
              'system-kbd flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray capitalize',
              textColor === 'secondary' && 'text-text-tertiary',
            )}
          >
            {getKeyboardKeyNameBySystem(key)}
          </div>
        ))
      }
    </div>
  )
}

export default memo(ShortcutsName)
