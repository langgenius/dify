import type { KeyboardEvent, MouseEvent, MouseEventHandler, ReactElement } from 'react'
import type { TriggerOption } from './test-run-menu'
import { DropdownMenuItem } from '@langgenius/dify-ui/dropdown-menu'
import { cloneElement, isValidElement } from 'react'
import { ShortcutKbd } from '../shortcuts/shortcut-kbd'

export type ShortcutMapping = {
  option: TriggerOption
  shortcutKey: string
}

export const getNormalizedShortcutKey = (event: Pick<KeyboardEvent, 'key'>) => {
  return event.key === '`' ? '~' : event.key
}

export const OptionRow = ({
  option,
  shortcutKey,
  onSelect,
}: {
  option: TriggerOption
  shortcutKey?: string
  onSelect: (option: TriggerOption) => void
}) => {
  return (
    <DropdownMenuItem
      className="h-auto px-3 py-1.5 system-md-regular"
      onClick={() => onSelect(option)}
    >
      <div className="flex min-w-0 flex-1 items-center">
        <div className="flex size-6 shrink-0 items-center justify-center">{option.icon}</div>
        <span className="ml-2 truncate">{option.name}</span>
      </div>
      {shortcutKey && (
        <ShortcutKbd displayKey={shortcutKey} className="ml-2" textColor="secondary" />
      )}
    </DropdownMenuItem>
  )
}

export function handleShortcutMenuKeyDown(
  event: KeyboardEvent,
  shortcutMappings: ShortcutMapping[],
  onSelect: (option: TriggerOption) => void,
) {
  if (
    event.defaultPrevented ||
    event.nativeEvent.isComposing ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return

  const normalizedKey = getNormalizedShortcutKey(event)
  const mapping = shortcutMappings.find(({ shortcutKey }) => shortcutKey === normalizedKey)
  if (!mapping) return

  event.preventDefault()
  event.stopPropagation()
  onSelect(mapping.option)
}

export const SingleOptionTrigger = ({
  children,
  runSoleOption,
}: {
  children: React.ReactNode
  runSoleOption: () => void
}) => {
  const handleRunClick = (event?: MouseEvent<HTMLElement>) => {
    if (event?.defaultPrevented) return

    runSoleOption()
  }

  if (isValidElement(children)) {
    const childElement = children as ReactElement<{ onClick?: MouseEventHandler<HTMLElement> }>
    const originalOnClick = childElement.props?.onClick

    // oxlint-disable-next-line react/no-clone-element
    return cloneElement(childElement, {
      onClick: (event: MouseEvent<HTMLElement>) => {
        if (typeof originalOnClick === 'function') originalOnClick(event)

        if (event?.defaultPrevented) return

        runSoleOption()
      },
    })
  }

  return (
    <button type="button" onClick={handleRunClick}>
      {children}
    </button>
  )
}
