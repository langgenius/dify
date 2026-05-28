import type { FormatDisplayOptions, RegisterableHotkey } from '@tanstack/react-hotkeys'
import type { WorkflowShortcutId } from './definitions'
import { cn } from '@langgenius/dify-ui/cn'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { getWorkflowShortcutDisplayHotkey } from './definitions'

type ShortcutKbdProps = {
  shortcut?: WorkflowShortcutId
  hotkey?: RegisterableHotkey | (string & {})
  className?: string
  textColor?: 'default' | 'secondary'
  bgColor?: 'gray' | 'white'
  platform?: FormatDisplayOptions['platform']
}

const getDisplayKeys = (
  hotkey: RegisterableHotkey | (string & {}),
  platform?: FormatDisplayOptions['platform'],
) => {
  const displayOptions = platform ? { platform } : undefined

  if (typeof hotkey !== 'string')
    return [formatForDisplay(hotkey, displayOptions)]

  return hotkey
    .split('+')
    .filter(Boolean)
    .map(key => formatForDisplay(key, displayOptions))
}

export const ShortcutKbd = ({
  shortcut,
  hotkey,
  className,
  textColor = 'default',
  bgColor = 'gray',
  platform,
}: ShortcutKbdProps) => {
  const displayHotkey = hotkey ?? (shortcut ? getWorkflowShortcutDisplayHotkey(shortcut) : undefined)

  if (!displayHotkey)
    return null

  const displayKeys = getDisplayKeys(displayHotkey, platform)

  return (
    <span
      className={cn(
        'flex items-center gap-0.5',
        className,
      )}
    >
      {
        displayKeys.map((key, index) => (
          <kbd
            key={`${key}-${index}`}
            className={cn(
              'flex h-4 min-w-4 items-center justify-center rounded-sm px-1 font-sans system-kbd capitalize not-italic',
              bgColor === 'gray' && 'bg-components-kbd-bg-gray',
              bgColor === 'white' && 'bg-components-kbd-bg-white text-text-primary-on-surface',
              textColor === 'secondary' && 'text-text-tertiary',
            )}
          >
            {key}
          </kbd>
        ))
      }
    </span>
  )
}
