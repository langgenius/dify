import type { SlashCommandHandler } from './types'
import { registerCommands, unregisterCommands } from './command-bus'

const NAV_ITEMS = [
  { id: 'apps', label: 'Apps', path: '/apps', iconClassName: 'i-ri-apps-2-line' },
  { id: 'datasets', label: 'Knowledge', path: '/datasets', iconClassName: 'i-ri-book-open-line' },
  { id: 'plugins', label: 'Plugins', path: '/plugins', iconClassName: 'i-ri-plug-line' },
  { id: 'tools', label: 'Tools', path: '/tools', iconClassName: 'i-ri-tools-line' },
  { id: 'explore', label: 'Explore', path: '/explore', iconClassName: 'i-ri-compass-line' },
  { id: 'account', label: 'Account', path: '/account', iconClassName: 'i-ri-user-line' },
]

/**
 * Go command - Navigate to a top-level section of the app
 */
export const goCommand: SlashCommandHandler = {
  name: 'go',
  aliases: ['navigate', 'nav'],
  description: 'Navigate to a section',
  mode: 'submenu',

  search(args: string, _locale: string = 'en') {
    const query = args.trim().toLowerCase()
    const items = NAV_ITEMS.filter(
      (item) => !query || item.id.includes(query) || item.label.toLowerCase().includes(query),
    )
    return items.map((item) => ({
      id: `go-${item.id}`,
      title: item.label,
      description: item.path,
      type: 'command' as const,
      icon: (
        <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
          <span aria-hidden className={`${item.iconClassName} size-4 text-text-tertiary`} />
        </div>
      ),
      data: { command: 'navigation.go', args: { path: item.path } },
    }))
  },

  register() {
    registerCommands({
      'navigation.go': async (args) => {
        if (args?.path) window.location.href = args.path
      },
    })
  },

  unregister() {
    unregisterCommands(['navigation.go'])
  },
}
