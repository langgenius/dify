import type { FC } from 'react'
import type { ActionItem } from './actions/types'
import { Command } from 'cmdk'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { slashCommandRegistry } from './actions/commands/registry'

type Props = Readonly<{
  actions: Record<string, ActionItem>
  onCommandSelect: (commandKey: string) => void
  searchFilter?: string
  commandValue?: string
  onCommandValueChange?: (value: string) => void
  originalQuery?: string
}>

const slashCommandDescriptionKeys = {
  '/create': 'gotoAnything.actions.createCategoryDesc',
  '/refine': 'gotoAnything.actions.refineCategoryDesc',
  '/theme': 'gotoAnything.actions.themeCategoryDesc',
  '/language': 'gotoAnything.actions.languageChangeDesc',
  '/account': 'gotoAnything.actions.accountDesc',
  '/feedback': 'gotoAnything.actions.feedbackDesc',
  '/docs': 'gotoAnything.actions.docDesc',
  '/community': 'gotoAnything.actions.communityDesc',
} as const

const actionDescriptionKeys = {
  '@app': 'gotoAnything.actions.searchApplicationsDesc',
  '@plugin': 'gotoAnything.actions.searchPluginsDesc',
  '@knowledge': 'gotoAnything.actions.searchKnowledgeBasesDesc',
  '@node': 'gotoAnything.actions.searchWorkflowNodesDesc',
} as const

const CommandSelector: FC<Props> = ({ actions, onCommandSelect, searchFilter, commandValue, onCommandValueChange, originalQuery }) => {
  const { t } = useTranslation()

  // Check if we're in slash command mode
  const isSlashMode = originalQuery?.trim().startsWith('/') || false

  // Get slash commands from registry
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
  }, [isSlashMode, searchFilter])

  const filteredActions = useMemo(() => {
    if (isSlashMode)
      return []

    return Object.values(actions).filter((action) => {
      // Exclude slash action when in @ mode
      if (action.key === '/')
        return false
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
        onCommandValueChange(allItems[0]!.shortcut)
    }
  }, [allItems, commandValue, onCommandValueChange])

  if (allItems.length === 0) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-center py-8 text-center text-text-tertiary">
          <div>
            <div className="text-sm font-medium text-text-tertiary">
              {t('gotoAnything.noMatchingCommands', { ns: 'app' })}
            </div>
            <div className="mt-1 text-xs text-text-quaternary">
              {t('gotoAnything.tryDifferentSearch', { ns: 'app' })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-3">
      <div className="mb-2 text-left text-sm font-medium text-text-secondary">
        {isSlashMode ? t('gotoAnything.groups.commands', { ns: 'app' }) : t('gotoAnything.selectSearchType', { ns: 'app' })}
      </div>
      <Command.Group className="space-y-1">
        {allItems.map(item => (
          <Command.Item
            key={item.key}
            value={item.shortcut}
            className="flex cursor-pointer items-center rounded-md
                     p-2
                     transition-all
                     duration-150 hover:bg-state-base-hover aria-selected:bg-state-base-hover-alt"
            onSelect={() => onCommandSelect(item.shortcut)}
          >
            <span className="min-w-18 text-left font-mono text-xs text-text-tertiary">
              {item.shortcut}
            </span>
            <span className="ml-3 text-sm text-text-secondary">
              {isSlashMode
                ? t(slashCommandDescriptionKeys[item.key as keyof typeof slashCommandDescriptionKeys] || item.description, { ns: 'app' })
                : t(actionDescriptionKeys[item.key as keyof typeof actionDescriptionKeys], { ns: 'app' })}
            </span>
          </Command.Item>
        ))}
      </Command.Group>
    </div>
  )
}

export default CommandSelector
