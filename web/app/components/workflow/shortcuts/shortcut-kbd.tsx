import type { KbdColor } from '@langgenius/dify-ui/kbd'
import type { FormatDisplayOptions, RegisterableHotkey } from '@tanstack/react-hotkeys'
import type { WorkflowShortcutId } from './definitions'
import { cn } from '@langgenius/dify-ui/cn'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { getWorkflowShortcutDisplayHotkey } from './definitions'

type ShortcutKbdProps = {
  shortcut?: WorkflowShortcutId
  hotkey?: RegisterableHotkey | (string & {})
  className?: string
  textColor?: 'default' | 'secondary'
  bgColor?: KbdColor
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
    <KbdGroup
      className={cn(
        className,
      )}
    >
      {
        displayKeys.map((key, index) => (
          <Kbd
            key={`${key}-${index}`}
            color={bgColor}
            className={cn(textColor === 'secondary' && 'text-text-tertiary')}
          >
            {key}
          </Kbd>
        ))
      }
    </KbdGroup>
  )
}
