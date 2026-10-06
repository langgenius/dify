import type { CommandSearchResult } from '../types'
import type { CommandContext, SlashCommand } from './types'

const THEME_ITEMS = [
  {
    id: 'system',
    titleKey: 'gotoAnything.actions.themeSystem',
    descKey: 'gotoAnything.actions.themeSystemDesc',
    iconClassName: 'i-ri-computer-line',
  },
  {
    id: 'light',
    titleKey: 'gotoAnything.actions.themeLight',
    descKey: 'gotoAnything.actions.themeLightDesc',
    iconClassName: 'i-ri-sun-line',
  },
  {
    id: 'dark',
    titleKey: 'gotoAnything.actions.themeDark',
    descKey: 'gotoAnything.actions.themeDarkDesc',
    iconClassName: 'i-ri-moon-line',
  },
] as const

const buildThemeCommands = (query: string, context: CommandContext): CommandSearchResult[] => {
  const q = query.toLowerCase()
  const list = THEME_ITEMS.filter(
    (item) =>
      !q ||
      context
        .t(($) => $[item.titleKey], { ns: 'app', lng: context.locale })
        .toLowerCase()
        .includes(q) ||
      item.id.includes(q),
  )
  return list.map((item) => ({
    id: item.id,
    title: context.t(($) => $[item.titleKey], { ns: 'app', lng: context.locale }),
    description: context.t(($) => $[item.descKey], { ns: 'app', lng: context.locale }),
    type: 'command' as const,
    icon: (
      <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
        <span aria-hidden className={`${item.iconClassName} size-4 text-text-tertiary`} />
      </div>
    ),
    data: { command: 'theme', args: { value: item.id } },
  }))
}

/**
 * Theme command handler
 */
export const themeCommand: SlashCommand = {
  name: 'theme',
  description: 'Switch between light and dark themes',
  mode: 'submenu',
  execute(args, context) {
    const item = THEME_ITEMS.find((item) => item.id === args.value)
    if (item) context.setTheme(item.id)
  },

  search(args: string, context) {
    return buildThemeCommands(args, context)
  },
}
