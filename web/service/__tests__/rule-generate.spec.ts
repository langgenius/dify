import type { Model } from '@/types/app'
import { normalizeRuleGenerateModelConfig } from '../rule-generate'

const model = (mode: Model['mode']): Model => ({
  provider: 'langgenius/openai/openai',
  name: 'gpt-4.1-mini',
  mode,
  completion_params: {},
})

describe('normalizeRuleGenerateModelConfig', () => {
  it('sends an agent app mode as the chat model mode', () => {
    const normalized = normalizeRuleGenerateModelConfig(model('agent-chat' as Model['mode']))

    expect(normalized.mode).toBe('chat')
  })

  it.each(['chat', 'completion', ''] as const)('leaves %s unchanged', (mode) => {
    const input = model(mode)

    expect(normalizeRuleGenerateModelConfig(input)).toBe(input)
  })
})
