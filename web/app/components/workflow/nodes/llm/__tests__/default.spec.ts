import type { LLMNodeType } from '../types'
import { AppModeEnum } from '@/types/app'
import { EditionType, PromptRole } from '../../../types'
import nodeDefault from '../default'

const t = (key: string) => key

const createPayload = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  ...nodeDefault.defaultValue,
  model: {
    ...nodeDefault.defaultValue.model,
    provider: 'langgenius/openai/gpt-4.1',
    mode: AppModeEnum.CHAT,
  },
  prompt_template: [{
    role: PromptRole.system,
    text: 'You are helpful.',
    edition_type: EditionType.basic,
  }],
  ...overrides,
}) as LLMNodeType

describe('llm default node validation', () => {
  it('should require a model provider before validating the prompt', () => {
    const result = nodeDefault.checkValid(createPayload({
      model: {
        ...nodeDefault.defaultValue.model,
        provider: '',
        name: 'gpt-4.1',
        mode: AppModeEnum.CHAT,
        completion_params: {
          temperature: 0.7,
        },
      },
    }), t)

    expect(result.isValid).toBe(false)
    expect(result.errorMessage).toBe('errorMsg.fieldRequired')
  })

  it('should return a valid result when the provider and prompt are configured', () => {
    const result = nodeDefault.checkValid(createPayload(), t)

    expect(result.isValid).toBe(true)
    expect(result.errorMessage).toBe('')
  })
})
