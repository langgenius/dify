import type { TFunction } from 'i18next'
import { withSelectorKey } from '@/test/i18n-mock'
import { getAppModeLabel } from '../app-mode-labels'

describe('getAppModeLabel', () => {
  const t = withSelectorKey((key: string, options?: Record<string, unknown>) => {
    const ns = (options?.ns as string | undefined) ?? ''
    return ns ? `${ns}.${key}` : key
  }, 'app') as unknown as TFunction<['app']>

  it('should return advanced chat label', () => {
    expect(getAppModeLabel('advanced-chat', t)).toBe('app.types.advanced')
  })

  it('should return agent chat label', () => {
    expect(getAppModeLabel('agent-chat', t)).toBe('app.types.agent')
  })

  it('should return chatbot label', () => {
    expect(getAppModeLabel('chat', t)).toBe('app.types.chatbot')
  })

  it('should return completion label', () => {
    expect(getAppModeLabel('completion', t)).toBe('app.types.completion')
  })

  it('should return workflow label for unknown mode', () => {
    expect(getAppModeLabel('unknown-mode', t)).toBe('app.types.workflow')
  })

  it('should return workflow label for workflow mode', () => {
    expect(getAppModeLabel('workflow', t)).toBe('app.types.workflow')
  })
})
