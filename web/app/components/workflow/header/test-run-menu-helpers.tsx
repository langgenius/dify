/* eslint-disable react-refresh/only-export-components */
import type { MouseEvent, MouseEventHandler, ReactElement } from 'react'
import type { TriggerOption } from './test-run-menu'
import {
  cloneElement,
  isValidElement,
  useEffect,
} from 'react'
import { DropdownMenuItem } from '@/app/components/base/ui/dropdown-menu'
import ShortcutsName from '../shortcuts-name'

export type ShortcutMapping = {
  option: TriggerOption
  shortcutKey: string
}

export const getNormalizedShortcutKey = (event: KeyboardEvent) => {
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
        <div className="flex h-6 w-6 shrink-0 items-center justify-center">
          {option.icon}
        </div>
        <span className="ml-2 truncate">{option.name}</span>
      </div>
      {shortcutKey && (
        <ShortcutsName keys={[shortcutKey]} className="ml-2" textColor="secondary" />
      )}
    </DropdownMenuItem>
  )
}

export const useShortcutMenu = ({
  open,
  shortcutMappings,
  handleSelect,
}: {
  open: boolean
  shortcutMappings: ShortcutMapping[]
  handleSelect: (option: TriggerOption) => void
}) => {
  useEffect(() => {
    if (!open)
      return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey)
        return

      const normalizedKey = getNormalizedShortcutKey(event)
      const mapping = shortcutMappings.find(({ shortcutKey }) => shortcutKey === normalizedKey)

      if (mapping) {
        event.preventDefault()
        handleSelect(mapping.option)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleSelect, open, shortcutMappings])
}

export const SingleOptionTrigger = ({
  children,
  runSoleOption,
}: {
  children: React.ReactNode
  runSoleOption: () => void
}) => {
  const handleRunClick = (event?: MouseEvent<HTMLElement>) => {
    if (event?.defaultPrevented)
      return

    runSoleOption()
  }

  if (isValidElement(children)) {
    const childElement = children as ReactElement<{ onClick?: MouseEventHandler<HTMLElement> }>
    const originalOnClick = childElement.props?.onClick

    // eslint-disable-next-line react/no-clone-element
    return cloneElement(childElement, {
      onClick: (event: MouseEvent<HTMLElement>) => {
        if (typeof originalOnClick === 'function')
          originalOnClick(event)

        if (event?.defaultPrevented)
          return

        runSoleOption()
      },
    })
  }

  return (
    <span onClick={handleRunClick}>
      {children}
    </span>
  )
}
