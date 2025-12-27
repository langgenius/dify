import type { FC } from 'react'
import type { ScopeDescriptor } from './actions/scope-registry'
import { Command } from 'cmdk'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { slashCommandRegistry } from './actions/commands/registry'
import { ACTION_KEYS, SCOPE_ACTION_I18N_MAP, SLASH_COMMAND_I18N_MAP } from './constants'

type Props = {
  scopes: ScopeDescriptor[]
  onCommandSelect: (commandKey: string) => void
  searchFilter?: string
  commandValue?: string
  onCommandValueChange?: (value: string) => void
  originalQuery?: string
}

const CommandSelector: FC<Props> = ({ scopes, onCommandSelect, searchFilter, commandValue, onCommandValueChange, originalQuery }) => {
  const { t } = useTranslation()
  const pathname = usePathname()

  // Check if we're in slash command mode
  const isSlashMode = originalQuery?.trim().startsWith('/') || false

  // Get slash commands from registry
  // Note: pathname is included in deps because some commands (like /zen) check isAvailable based on current route
  const slashCommands = useMemo(() => {
    if (!isSlashMode)
      return []

    const availableCommands = slashCommandRegistry.getAvailableCommands()
    const filter = searchFilter?.toLowerCase() || '' // searchFilter already has '/' removed

    return availableCommands.filter((cmd) => {
      if (!filter)
        return true
      return cmd.name.toLowerCase().includes(filter)
    }).map(cmd => ({
      key: `/${cmd.name}`,
      shortcut: `/${cmd.name}`,
      title: cmd.name,
      description: cmd.description,
    }))
  }, [isSlashMode, searchFilter, pathname])

  const filteredScopes = useMemo(() => {
    if (isSlashMode)
      return []

    return scopes.filter((scope) => {
      // Exclude slash action when in @ mode
      if (scope.id === 'slash' || scope.shortcut === ACTION_KEYS.SLASH)
        return false
      if (!searchFilter)
        return true

      // Match against shortcut/aliases or title
      const filterLower = searchFilter.toLowerCase()
      const shortcuts = [scope.shortcut, ...(scope.aliases || [])]
      return shortcuts.some(shortcut => shortcut.toLowerCase().includes(filterLower))
        || scope.title.toLowerCase().includes(filterLower)
    }).map(scope => ({
      key: scope.shortcut, // Map to shortcut for UI display consistency
      shortcut: scope.shortcut,
      title: scope.title,
      description: scope.description,
    }))
  }, [scopes, searchFilter, isSlashMode])

  const allItems = isSlashMode ? slashCommands : filteredScopes

  useEffect(() => {
    if (allItems.length > 0 && onCommandValueChange) {
      const currentValueExists = allItems.some(item => item.shortcut === commandValue)
      if (!currentValueExists)
        onCommandValueChange(allItems[0].shortcut)
    }
  }, [searchFilter, allItems.length])

  if (allItems.length === 0) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-center py-8 text-center text-text-tertiary">
          <div>
            <div className="text-sm font-medium text-text-tertiary">
              {t('app.gotoAnything.noMatchingCommands')}
            </div>
            <div className="mt-1 text-xs text-text-quaternary">
              {t('app.gotoAnything.tryDifferentSearch')}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-3">
      <div className="mb-2 text-left text-sm font-medium text-text-secondary">
        {isSlashMode ? t('app.gotoAnything.groups.commands') : t('app.gotoAnything.selectSearchType')}
      </div>
      <Command.Group className="space-y-1">
        {allItems.map(item => (
          <Command.Item
            key={item.key}
            value={item.shortcut}
            className="flex cursor-pointer items-center rounded-md
                     p-2
                     transition-all
                     duration-150 hover:bg-state-base-hover aria-[selected=true]:bg-state-base-hover-alt"
            onSelect={() => onCommandSelect(item.shortcut)}
          >
            <span className="min-w-[4.5rem] text-left font-mono text-xs text-text-tertiary">
              {item.shortcut}
            </span>
            <span className="ml-3 text-sm text-text-secondary">
              {isSlashMode
                ? t((SLASH_COMMAND_I18N_MAP[item.key] || item.description) as any)
                : t((SCOPE_ACTION_I18N_MAP[item.key] || item.description) as any)}
            </span>
          </Command.Item>
        ))}
      </Command.Group>
    </div>
  )
}

export default CommandSelector
