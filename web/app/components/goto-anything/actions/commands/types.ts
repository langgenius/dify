import type { TFunction } from 'i18next'
import type { CommandSearchResult } from '../types'
import type { useWorkflowGeneratorStore } from '@/app/components/workflow/workflow-generator/store'

export type CommandContext = {
  t: TFunction<['app', 'common', 'modelProvider', 'accountSettings']>
  locale: string
  agentsAvailable: boolean
  skillsAvailable: boolean
  currentApp: { id: string; mode: 'workflow' | 'advanced-chat' } | null
  setTheme: (theme: string) => void
  setLocale: (locale: string) => Promise<void>
  getDocsHomeUrl: () => string
  onError: (error: unknown) => void
  navigate: (path: string) => void
  openExternal: (url: string) => void
  openGenerator: ReturnType<typeof useWorkflowGeneratorStore.getState>['openGenerator']
}

export type SlashCommand = {
  name: string
  aliases?: readonly string[]
  description: string
  mode?: 'direct' | 'submenu'
  isAvailable?: (context: CommandContext) => boolean
  execute: (args: Record<string, unknown>, context: CommandContext) => void | Promise<void>
  search: (args: string, context: CommandContext) => CommandSearchResult[]
}
