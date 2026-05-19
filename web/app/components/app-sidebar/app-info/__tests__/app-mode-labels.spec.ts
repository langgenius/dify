import type { TFunction } from 'i18next'
import { AppModeEnum } from '@/types/app'
import { getAppModeLabel } from '../app-mode-labels'

describe('getAppModeLabel', () => {
  const t: TFunction = ((key: string, options?: Record<string, unknown>) => {
    const ns = (options?.ns as string | undefined) ?? ''
    return ns ? `${ns}.${key}` : key
  }) as TFunction

  it('should return advanced chat label', () => {
    expect(getAppModeLabel(AppModeEnum.ADVANCED_CHAT, t)).toBe('app.types.advanced')
  })

  it('should return agent chat label', () => {
    expect(getAppModeLabel(AppModeEnum.AGENT_CHAT, t)).toBe('app.types.agent')
  })

  it('should return chatbot label', () => {
    expect(getAppModeLabel(AppModeEnum.CHAT, t)).toBe('app.types.chatbot')
  })

  it('should return completion label', () => {
    expect(getAppModeLabel(AppModeEnum.COMPLETION, t)).toBe('app.types.completion')
  })

  it('should return workflow label for unknown mode', () => {
    expect(getAppModeLabel('unknown-mode', t)).toBe('app.types.workflow')
  })

  it('should return workflow label for workflow mode', () => {
    expect(getAppModeLabel(AppModeEnum.WORKFLOW, t)).toBe('app.types.workflow')
  })
})
