import type { FC } from 'react'
import { useEffect, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { Command } from 'cmdk'
import { useTranslation } from 'react-i18next'
import type { ActionItem } from './actions/types'
import { slashCommandRegistry } from './actions/commands/registry'

type Props = {
  actions: Record<string, ActionItem>
  onCommandSelect: (commandKey: string) => void
  searchFilter?: string
  commandValue?: string
  onCommandValueChange?: (value: string) => void
  originalQuery?: string
}

const CommandSelector: FC<Props> = ({ actions, onCommandSelect, searchFilter, commandValue, onCommandValueChange, originalQuery }) => {
  const { t } = useTranslation()
  const pathname = usePathname()

  // Check if we're in slash command mode
  const isSlashMode = originalQuery?.trim().startsWith('/') || false

  // Get slash commands from registry
  // Note: pathname is included in deps because some commands (like /zen) check isAvailable based on current route
  const slashCommands = useMemo(() => {
    if (!isSlashMode) return []

    const availableCommands = slashCommandRegistry.getAvailableCommands()
    const filter = searchFilter?.toLowerCase() || '' // searchFilter already has '/' removed

    return availableCommands.filter((cmd) => {
      if (!filter) return true
      return cmd.name.toLowerCase().includes(filter)
    }).map(cmd => ({
      key: `/${cmd.name}`,
      shortcut: `/${cmd.name}`,
      title: cmd.name,
      description: cmd.description,
    }))
  }, [isSlashMode, searchFilter, pathname])

  const filteredActions = useMemo(() => {
    if (isSlashMode) return []

    return Object.values(actions).filter((action) => {
      // Exclude slash action when in @ mode
      if (action.key === '/') return false
      if (!searchFilter)
        return true
      const filterLower = searchFilter.toLowerCase()
      return action.shortcut.toLowerCase().includes(filterLower)
    })
  }, [actions, searchFilter, isSlashMode])

  const allItems = isSlashMode ? slashCommands : filteredActions

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
              {isSlashMode ? (
                (() => {
                  const slashKeyMap: Record<string, string> = {
                    '/theme': 'app.gotoAnything.actions.themeCategoryDesc',
                    '/language': 'app.gotoAnything.actions.languageChangeDesc',
                    '/account': 'app.gotoAnything.actions.accountDesc',
                    '/feedback': 'app.gotoAnything.actions.feedbackDesc',
                    '/docs': 'app.gotoAnything.actions.docDesc',
                    '/community': 'app.gotoAnything.actions.communityDesc',
                    '/zen': 'app.gotoAnything.actions.zenDesc',
                  }
                  return t(slashKeyMap[item.key] || item.description)
                })()
              ) : (
                (() => {
                  const keyMap: Record<string, string> = {
                    '@app': 'app.gotoAnything.actions.searchApplicationsDesc',
                    '@plugin': 'app.gotoAnything.actions.searchPluginsDesc',
                    '@knowledge': 'app.gotoAnything.actions.searchKnowledgeBasesDesc',
                    '@node': 'app.gotoAnything.actions.searchWorkflowNodesDesc',
                  }
                  return t(keyMap[item.key])
                })()
              )}
            </span>
          </Command.Item>
        ))}
      </Command.Group>
    </div>
  )
}

export default CommandSelector
