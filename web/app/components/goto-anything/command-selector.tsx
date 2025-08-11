import type { FC } from 'react'
import { Command } from 'cmdk'
import { useTranslation } from 'react-i18next'
import type { ActionItem } from './actions/types'

type Props = {
  actions: Record<string, ActionItem>
  onCommandSelect: (commandKey: string) => void
}

const CommandSelector: FC<Props> = ({ actions, onCommandSelect }) => {
  const { t } = useTranslation()

  return (
    <div className="p-4">
      <div className="mb-3 text-left text-sm font-medium text-text-secondary">
        {t('app.gotoAnything.selectSearchType')}
      </div>
      <Command.Group className="space-y-1">
        {Object.values(actions).map(action => (
          <Command.Item
            key={action.key}
            value={action.shortcut}
            className="flex cursor-pointer items-center rounded-md
                     p-2.5
                     transition-all
                     duration-150 hover:bg-state-base-hover aria-[selected=true]:bg-state-base-hover"
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
