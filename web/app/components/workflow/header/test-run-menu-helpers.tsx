import type { KeyboardEvent, MouseEvent, MouseEventHandler, ReactElement } from 'react'
import type { TriggerOption } from './test-run-menu'
import { cloneElement, isValidElement } from 'react'

export type ShortcutMapping = {
  option: TriggerOption
  shortcutKey: string
}

export const getNormalizedShortcutKey = (event: Pick<KeyboardEvent, 'key'>) => {
  return event.key === '`' ? '~' : event.key
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
