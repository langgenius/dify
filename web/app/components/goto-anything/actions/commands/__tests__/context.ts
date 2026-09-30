import type { CommandContext } from '../types'
import { withSelectorKey } from '@/test/i18n-mock'

export function createCommandContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    t: withSelectorKey((key: string) => key) as CommandContext['t'],
    locale: 'en-US',
    agentsAvailable: true,
    skillsAvailable: true,
    currentApp: null,
    setTheme: vi.fn(),
    setLocale: vi.fn().mockResolvedValue(undefined),
    getDocsHomeUrl: () => 'https://docs.dify.ai/en',
    onError: vi.fn(),
    navigate: vi.fn(),
    openExternal: vi.fn(),
    openGenerator: vi.fn(),
    ...overrides,
  }
}
