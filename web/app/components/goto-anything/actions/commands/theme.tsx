import type { CommandSearchResult } from '../types'
import type { CommandContext, SlashCommand } from './types'
import type { ThemePreference } from '@/features/theme/theme'
import { isThemePreference, themeOptions } from '@/features/theme/theme'

const themeCommandDescriptionKeys = {
  light: 'gotoAnything.actions.themeLightDesc',
  dark: 'gotoAnything.actions.themeDarkDesc',
  system: 'gotoAnything.actions.themeSystemDesc',
} as const satisfies Record<ThemePreference, string>

const buildThemeCommands = (query: string, context: CommandContext): CommandSearchResult[] => {
  const q = query.toLowerCase()
  return themeOptions
    .map((option) => ({
      ...option,
      title: context.t(($) => $[option.labelKey], { ns: 'common', lng: context.locale }),
    }))
    .filter((option) => !q || option.title.toLowerCase().includes(q) || option.value.includes(q))
    .map((option) => ({
      id: option.value,
      title: option.title,
      description: context.t(($) => $[themeCommandDescriptionKeys[option.value]], {
        ns: 'app',
        lng: context.locale,
      }),
      type: 'command' as const,
      icon: (
        <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
          <span aria-hidden className={`${option.iconClassName} size-4 text-text-tertiary`} />
        </div>
      ),
      data: { command: 'theme', args: { value: option.value } },
    }))
}

/**
 * Theme command handler
 */
export const themeCommand: SlashCommand = {
  name: 'theme',
  description: 'Change appearance',
  mode: 'submenu',
  execute(args, context) {
    if (isThemePreference(args.value)) context.setThemePreference(args.value)
  },

  search(args: string, context) {
    return buildThemeCommands(args, context)
  },
}
