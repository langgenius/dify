import type { KbdColor } from '@langgenius/dify-ui/kbd'
import type { FormatDisplayOptions, Hotkey, IndividualKey } from '@tanstack/react-hotkeys'
import type { WorkflowCanvasShortcutId } from './definitions'
import { cn } from '@langgenius/dify-ui/cn'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { getWorkflowCanvasShortcutDisplayKey } from './definitions'

type ShortcutKbdSource =
  | { shortcut: WorkflowCanvasShortcutId; hotkey?: never; displayKey?: never }
  | { shortcut?: never; hotkey: Hotkey; displayKey?: never }
  | { shortcut?: never; hotkey?: never; displayKey: string }

type ShortcutKbdProps = ShortcutKbdSource & {
  className?: string
  textColor?: 'default' | 'secondary'
  bgColor?: KbdColor
  platform?: FormatDisplayOptions['platform']
}

const getDisplayKeys = (
  hotkey: Hotkey | IndividualKey,
  platform?: FormatDisplayOptions['platform'],
) => {
  const displayOptions = platform ? { platform } : undefined

  return hotkey
    .split('+')
    .filter(Boolean)
    .map((key) => formatForDisplay(key, displayOptions))
}

export const ShortcutKbd = ({
  shortcut,
  hotkey,
  displayKey,
  className,
  textColor = 'default',
  bgColor = 'gray',
  platform,
}: ShortcutKbdProps) => {
  const shortcutDisplayKey =
    hotkey ?? (shortcut ? getWorkflowCanvasShortcutDisplayKey(shortcut) : undefined)

  const displayOptions = platform ? { platform } : undefined
  const displayKeys = displayKey
    ? [formatForDisplay(displayKey, displayOptions)]
    : shortcutDisplayKey
      ? getDisplayKeys(shortcutDisplayKey, platform)
      : []

  if (!displayKeys.length) return null

  return (
    <KbdGroup className={cn(className)}>
      {displayKeys.map((key) => (
        <Kbd
          key={key}
          color={bgColor}
          className={cn(textColor === 'secondary' && 'text-text-tertiary')}
        >
          {key}
        </Kbd>
      ))}
    </KbdGroup>
  )
}
