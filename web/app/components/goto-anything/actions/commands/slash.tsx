import type { ActionItem } from '../types'
import { getI18n } from 'react-i18next'
import { executeCommand } from './command-bus'
import { slashCommandRegistry } from './registry'

export const slashAction: ActionItem = {
  key: '/',
  shortcut: '/',
  get title() {
    const i18n = getI18n()
    return i18n.t(($) => $['gotoAnything.actions.slashTitle'], { ns: 'app' })
  },
  get description() {
    const i18n = getI18n()
    return i18n.t(($) => $['gotoAnything.actions.slashDesc'], { ns: 'app' })
  },
  source: 'local',
  action: (result) => {
    if (result.type !== 'command') return
    const { command, args } = result.data
    executeCommand(command, args)
  },
  search: (query, _searchTerm = '') => {
    const i18n = getI18n()
    // Delegate all search logic to the command registry system
    return slashCommandRegistry.search(query, i18n.language)
  },
}
