import type { SlashCommandHandler } from './types'
import { registerCommands, unregisterCommands } from './command-bus'

const NAV_ITEMS = [
  { id: 'apps', label: 'Apps', path: '/apps', iconClassName: 'i-ri-apps-2-line' },
  { id: 'datasets', label: 'Knowledge', path: '/datasets', iconClassName: 'i-ri-book-open-line' },
  {
    id: 'agents',
    label: 'Agents',
    path: '/agents',
    iconClassName: 'i-custom-vender-main-nav-roster',
    availability: 'agents',
  },
  {
    id: 'skills',
    label: 'Skills',
    path: '/skills',
    iconClassName: 'i-custom-vender-main-nav-skill',
    availability: 'skills',
  },
  { id: 'plugins', label: 'Plugins', path: '/plugins', iconClassName: 'i-ri-plug-line' },
  { id: 'tools', label: 'Tools', path: '/tools', iconClassName: 'i-ri-tools-line' },
  { id: 'home', label: 'Home', path: '/', iconClassName: 'i-ri-compass-line' },
  { id: 'account', label: 'Account', path: '/account', iconClassName: 'i-ri-user-line' },
] as const

type GoDeps = {
  agentsAvailable: boolean
  skillsAvailable: boolean
}

let availability: GoDeps = {
  agentsAvailable: false,
  skillsAvailable: true,
}

/**
 * Go command - Navigate to a top-level section of the app
 */
export const goCommand: SlashCommandHandler<GoDeps> = {
  name: 'go',
  aliases: ['navigate', 'nav'],
  description: 'Navigate to a section',
  mode: 'submenu',

  search(args: string, _locale: string = 'en') {
    const query = args.trim().toLowerCase()
    const items = NAV_ITEMS.filter((item) => {
      if ('availability' in item) {
        if (item.availability === 'agents' && !availability.agentsAvailable) return false
        if (item.availability === 'skills' && !availability.skillsAvailable) return false
      }

      return !query || item.id.includes(query) || item.label.toLowerCase().includes(query)
    })
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

  register(deps: GoDeps) {
    availability = deps
    registerCommands({
      'navigation.go': async (args) => {
        if (args?.path) window.location.href = args.path
      },
    })
  },

  unregister() {
    availability = {
      agentsAvailable: false,
      skillsAvailable: true,
    }
    unregisterCommands(['navigation.go'])
  },
}
