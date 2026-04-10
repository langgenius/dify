import type { LLMNodeType } from '../../types'
import type { LLMDefaultConfig } from '../use-llm-input-manager'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  BlockEnum,
  EditionType,
  PromptRole,
} from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import useLLMInputManager from '../use-llm-input-manager'

const createPayload = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  type: BlockEnum.LLM,
  title: 'LLM',
  desc: '',
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: AppModeEnum.CHAT,
    completion_params: {},
  },
  prompt_template: [{
    role: PromptRole.system,
    text: 'You are helpful.',
    edition_type: EditionType.basic,
  }],
  context: {
    enabled: false,
    variable_selector: [],
  },
  vision: {
    enabled: false,
  },
  ...overrides,
})

const defaultConfig: LLMDefaultConfig = {
  prompt_templates: {
    chat_model: {
      prompts: [{
        role: PromptRole.system,
        text: 'Default chat prompt',
        edition_type: EditionType.basic,
      }],
    },
    completion_model: {
      prompt: {
        role: PromptRole.user,
        text: 'Default completion prompt',
        edition_type: EditionType.basic,
      },
      conversation_histories_role: {
        user_prefix: 'USER',
        assistant_prefix: 'ASSISTANT',
      },
    },
  },
}

describe('use-llm-input-manager', () => {
  it('ignores default configs that do not define prompt templates', () => {
    const handleSetInputs = vi.fn()
    const { result } = renderHook(() => useLLMInputManager({
      inputs: createPayload(),
      doSetInputs: handleSetInputs,
      defaultConfig: {},
      isChatModel: true,
    }))

    const draftPayload = createPayload()

    act(() => {
      result.current.appendDefaultPromptConfig(draftPayload, {})
    })

    expect(draftPayload.prompt_template).toEqual(createPayload().prompt_template)
    expect(handleSetInputs).not.toHaveBeenCalled()
  })

  it('hydrates the default chat prompt when the payload has no prompt template', async () => {
    const handleSetInputs = vi.fn()

    renderHook(() => useLLMInputManager({
      inputs: createPayload({
        prompt_template: undefined as unknown as LLMNodeType['prompt_template'],
      }),
      doSetInputs: handleSetInputs,
      defaultConfig,
      isChatModel: true,
    }))

    await waitFor(() => {
      expect(handleSetInputs).toHaveBeenCalledWith(expect.objectContaining({
        prompt_template: defaultConfig.prompt_templates!.chat_model.prompts,
      }))
    })
  })

  it('applies completion defaults and injects the default role prefix when memory has none', async () => {
    const handleSetInputs = vi.fn()
    const { result } = renderHook(() => useLLMInputManager({
      inputs: createPayload({
        model: {
          provider: 'openai',
          name: 'gpt-4o-mini',
          mode: AppModeEnum.COMPLETION,
          completion_params: {},
        },
      }),
      doSetInputs: handleSetInputs,
      defaultConfig,
      isChatModel: false,
    }))

    const draftPayload = createPayload({
      model: {
        provider: 'openai',
        name: 'gpt-4o-mini',
        mode: AppModeEnum.COMPLETION,
        completion_params: {},
      },
    })

    act(() => {
      result.current.appendDefaultPromptConfig(draftPayload, defaultConfig, false)
    })

    act(() => {
      result.current.setInputs(createPayload({
        model: {
          provider: 'openai',
          name: 'gpt-4o-mini',
          mode: AppModeEnum.COMPLETION,
          completion_params: {},
        },
        prompt_template: draftPayload.prompt_template,
        memory: {
          window: {
            enabled: true,
            size: 8,
          },
          query_prompt_template: '{{#sys.query#}}',
        },
      }))
    })

    expect(handleSetInputs).toHaveBeenLastCalledWith(expect.objectContaining({
      prompt_template: defaultConfig.prompt_templates!.completion_model.prompt,
      memory: expect.objectContaining({
        role_prefix: {
          user: 'USER',
          assistant: 'ASSISTANT',
        },
      }),
    }))
  })

  it('passes inputs through unchanged when memory already has a role prefix or is absent', () => {
    const handleSetInputs = vi.fn()
    const { result } = renderHook(() => useLLMInputManager({
      inputs: createPayload(),
      doSetInputs: handleSetInputs,
      defaultConfig,
      isChatModel: true,
    }))

    const payloadWithoutMemory = createPayload()
    const payloadWithRolePrefix = createPayload({
      memory: {
        role_prefix: {
          user: 'U',
          assistant: 'A',
        },
        window: {
          enabled: false,
          size: 10,
        },
        query_prompt_template: '{{#sys.query#}}',
      },
    })

    act(() => {
      result.current.setInputs(payloadWithoutMemory)
      result.current.setInputs(payloadWithRolePrefix)
    })

    expect(handleSetInputs).toHaveBeenNthCalledWith(1, payloadWithoutMemory)
    expect(handleSetInputs).toHaveBeenNthCalledWith(2, payloadWithRolePrefix)
  })
})
