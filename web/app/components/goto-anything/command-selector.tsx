import type { FC } from 'react'
import { useEffect } from 'react'
import { Command } from 'cmdk'
import { useTranslation } from 'react-i18next'
import type { ActionItem } from './actions/types'

type Props = {
  actions: Record<string, ActionItem>
  onCommandSelect: (commandKey: string) => void
  searchFilter?: string
  commandValue?: string
  onCommandValueChange?: (value: string) => void
}

const CommandSelector: FC<Props> = ({ actions, onCommandSelect, searchFilter, commandValue, onCommandValueChange }) => {
  const { t } = useTranslation()

  const filteredActions = Object.values(actions).filter((action) => {
    if (!searchFilter)
      return true
    const filterLower = searchFilter.toLowerCase()
    return action.shortcut.toLowerCase().includes(filterLower)
  })

  useEffect(() => {
    if (filteredActions.length > 0 && onCommandValueChange) {
      const currentValueExists = filteredActions.some(action => action.shortcut === commandValue)
      if (!currentValueExists)
        onCommandValueChange(filteredActions[0].shortcut)
    }
  }, [searchFilter, filteredActions.length])

  if (filteredActions.length === 0) {
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
    <div className="p-4">
      <div className="mb-3 text-left text-sm font-medium text-text-secondary">
        {t('app.gotoAnything.selectSearchType')}
      </div>
      <Command.Group className="space-y-1">
        {filteredActions.map(action => (
          <Command.Item
            key={action.key}
            value={action.shortcut}
            className="flex cursor-pointer items-center rounded-md
                     p-2.5
                     transition-all
                     duration-150 hover:bg-state-base-hover aria-[selected=true]:bg-state-base-hover-alt"
            onSelect={() => onCommandSelect(action.shortcut)}
          >
            <span className="min-w-[4.5rem] text-left font-mono text-xs text-text-tertiary">
              {action.shortcut}
            </span>
            <span className="ml-3 text-sm text-text-secondary">
              {(() => {
                const keyMap: Record<string, string> = {
                  '@app': 'app.gotoAnything.actions.searchApplicationsDesc',
                  '@plugin': 'app.gotoAnything.actions.searchPluginsDesc',
                  '@knowledge': 'app.gotoAnything.actions.searchKnowledgeBasesDesc',
                  '@run': 'app.gotoAnything.actions.runDesc',
                  '@node': 'app.gotoAnything.actions.searchWorkflowNodesDesc',
                }
                return t(keyMap[action.key])
              })()}
            </span>
          </Command.Item>
        ))}
      </Command.Group>
    </div>
  )
}

export default CommandSelector
