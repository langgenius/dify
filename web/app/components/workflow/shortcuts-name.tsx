import { memo } from 'react'
import { cn } from '@/utils/classnames'
import { getKeyboardKeyNameBySystem } from './utils'

type ShortcutsNameProps = {
  keys: string[]
  className?: string
  textColor?: 'default' | 'secondary'
  bgColor?: 'gray' | 'white'
  ariaHidden?: boolean
}
const ShortcutsName = ({
  keys,
  className,
  textColor = 'default',
  bgColor = 'gray',
  ariaHidden = true,
}: ShortcutsNameProps) => {
  return (
    <div
      aria-hidden={ariaHidden}
      className={cn(
        'flex items-center gap-0.5',
        className,
      )}
    >
      {
        keys.map(key => (
          <kbd
            key={key}
            className={cn(
              'system-kbd flex h-4 min-w-4 items-center justify-center rounded-[4px] px-1 capitalize',
              bgColor === 'gray' && 'bg-components-kbd-bg-gray',
              bgColor === 'white' && 'bg-components-kbd-bg-white text-text-primary-on-surface',
              textColor === 'secondary' && 'text-text-tertiary',
            )}
          >
            {(typeof getKeyboardKeyNameBySystem === 'function' ? getKeyboardKeyNameBySystem(key) : key)}
          </kbd>
        ))
      }
    </div>
  )
}

export default memo(ShortcutsName)
