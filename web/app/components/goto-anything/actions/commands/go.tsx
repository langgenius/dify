import type { SlashCommandHandler } from './types'
import {
  RiApps2Line,
  RiBookOpenLine,
  RiCompassLine,
  RiPlugLine,
  RiToolsLine,
  RiUserLine,
} from '@remixicon/react'
import * as React from 'react'
import { registerCommands, unregisterCommands } from './command-bus'

const NAV_ITEMS = [
  { id: 'apps', label: 'Apps', path: '/apps', icon: RiApps2Line },
  { id: 'datasets', label: 'Knowledge', path: '/datasets', icon: RiBookOpenLine },
  { id: 'plugins', label: 'Plugins', path: '/plugins', icon: RiPlugLine },
  { id: 'tools', label: 'Tools', path: '/tools', icon: RiToolsLine },
  { id: 'explore', label: 'Explore', path: '/explore', icon: RiCompassLine },
  { id: 'account', label: 'Account', path: '/account', icon: RiUserLine },
]

/**
 * Go command - Navigate to a top-level section of the app
 */
export const goCommand: SlashCommandHandler = {
  name: 'go',
  aliases: ['navigate', 'nav'],
  description: 'Navigate to a section',
  mode: 'submenu',

  async search(args: string, _locale: string = 'en') {
    const query = args.trim().toLowerCase()
    const items = NAV_ITEMS.filter(
      item => !query || item.id.includes(query) || item.label.toLowerCase().includes(query),
    )
    return items.map(item => ({
      id: `go-${item.id}`,
      title: item.label,
      description: item.path,
      type: 'command' as const,
      icon: (
        <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
          <item.icon className="h-4 w-4 text-text-tertiary" />
        </div>
      ),
      data: { command: 'navigation.go', args: { path: item.path } },
    }))
  },

  register() {
    registerCommands({
      'navigation.go': async (args) => {
        if (args?.path)
          window.location.href = args.path
      },
    })
  },

  unregister() {
    unregisterCommands(['navigation.go'])
  },
}
