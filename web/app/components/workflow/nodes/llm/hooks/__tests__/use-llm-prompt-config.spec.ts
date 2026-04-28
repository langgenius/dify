import type { MutableRefObject } from 'react'
import type { LLMNodeType } from '../../types'
import { act, renderHook } from '@testing-library/react'
import {
  CONTEXT_PLACEHOLDER_TEXT,
  HISTORY_PLACEHOLDER_TEXT,
  QUERY_PLACEHOLDER_TEXT,
} from '@/app/components/base/prompt-editor/constants'
import {
  BlockEnum,
  EditionType,
  PromptRole,
  VarType,
} from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import useLLMPromptConfig from '../use-llm-prompt-config'

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
    text: 'Base prompt',
    edition_type: EditionType.basic,
  }],
  prompt_config: {
    jinja2_variables: [],
  },
  context: {
    enabled: false,
    variable_selector: [],
  },
  vision: {
    enabled: false,
  },
  ...overrides,
})

const createSetInputs = (inputRef: MutableRefObject<LLMNodeType>) => {
  return vi.fn((nextInputs: LLMNodeType) => {
    inputRef.current = nextInputs
  })
}

describe('use-llm-prompt-config', () => {
  it('initializes prompt config storage when it is missing or incomplete', () => {
    const missingConfigRef = {
      current: createPayload({
        prompt_template: [{
          role: PromptRole.user,
          text: 'Template',
          edition_type: EditionType.jinja2,
          jinja2_text: '{{ city }}',
        }],
        prompt_config: undefined as unknown as LLMNodeType['prompt_config'],
      }),
    } as MutableRefObject<LLMNodeType>
    const handleMissingConfigInputs = createSetInputs(missingConfigRef)

    const { result: missingConfigResult } = renderHook(() => useLLMPromptConfig({
      inputs: missingConfigRef.current,
      inputRef: missingConfigRef,
      isChatMode: true,
      isChatModel: true,
      setInputs: handleMissingConfigInputs,
    }))

    act(() => {
      missingConfigResult.current.handleAddEmptyVariable()
    })

    expect(handleMissingConfigInputs).toHaveBeenCalledWith(expect.objectContaining({
      prompt_config: {
        jinja2_variables: [{
          variable: '',
          value_selector: [],
        }],
      },
    }))

    const missingVariablesRef = {
      current: createPayload({
        prompt_template: [{
          role: PromptRole.user,
          text: 'Template',
          edition_type: EditionType.jinja2,
          jinja2_text: '{{ budget }}',
        }],
        prompt_config: {} as LLMNodeType['prompt_config'],
      }),
    } as MutableRefObject<LLMNodeType>
    const handleMissingVariablesInputs = createSetInputs(missingVariablesRef)

    const { result: missingVariablesResult } = renderHook(() => useLLMPromptConfig({
      inputs: missingVariablesRef.current,
      inputRef: missingVariablesRef,
      isChatMode: true,
      isChatModel: true,
      setInputs: handleMissingVariablesInputs,
    }))

    act(() => {
      missingVariablesResult.current.handleAddVariable({
        variable: 'budget',
        value_selector: ['start', 'budget'],
      })
    })

    expect(handleMissingVariablesInputs).toHaveBeenCalledWith(expect.objectContaining({
      prompt_config: {
        jinja2_variables: [{
          variable: 'budget',
          value_selector: ['start', 'budget'],
        }],
      },
    }))
  })

  it('derives chat prompt status and filters the supported variable types', () => {
    const inputRef = {
      current: createPayload({
        prompt_template: [
          {
            role: PromptRole.system,
            text: `Question: ${QUERY_PLACEHOLDER_TEXT}`,
            edition_type: EditionType.basic,
          },
          {
            role: PromptRole.user,
            text: 'Template',
            edition_type: EditionType.jinja2,
            jinja2_text: '{{ old_name }}',
          },
        ],
        context: {
          enabled: true,
          variable_selector: [],
        },
      }),
    } as MutableRefObject<LLMNodeType>

    const { result } = renderHook(() => useLLMPromptConfig({
      inputs: inputRef.current,
      inputRef,
      isChatMode: true,
      isChatModel: true,
      setInputs: createSetInputs(inputRef),
    }))

    expect(result.current.hasSetBlockStatus).toEqual({
      history: false,
      query: true,
      context: false,
    })
    expect(result.current.shouldShowContextTip).toBe(true)
    expect(result.current.isShowVars).toBe(true)
    expect(result.current.filterInputVar({ type: VarType.string } as never)).toBe(true)
    expect(result.current.filterInputVar({ type: VarType.boolean } as never)).toBe(false)
    expect(result.current.filterJinja2InputVar({ type: VarType.object } as never)).toBe(true)
    expect(result.current.filterJinja2InputVar({ type: VarType.file } as never)).toBe(false)
    expect(result.current.filterVar({ type: VarType.arrayObject } as never)).toBe(true)
    expect(result.current.filterVar({ type: VarType.boolean } as never)).toBe(false)
  })

  it('updates variables, context, prompt, and memory for chat prompts', () => {
    const inputRef = {
      current: createPayload({
        prompt_template: [{
          role: PromptRole.user,
          text: 'Template',
          edition_type: EditionType.jinja2,
          jinja2_text: '{{ old_name }}',
        }],
        prompt_config: {
          jinja2_variables: [{
            variable: 'old_name',
            value_selector: ['start', 'old_name'],
          }],
        },
      }),
    } as MutableRefObject<LLMNodeType>
    const handleSetInputs = createSetInputs(inputRef)

    const { result } = renderHook(() => useLLMPromptConfig({
      inputs: inputRef.current,
      inputRef,
      isChatMode: true,
      isChatModel: true,
      setInputs: handleSetInputs,
    }))

    act(() => {
      result.current.handleAddEmptyVariable()
      result.current.handleAddVariable({
        variable: 'budget',
        value_selector: ['start', 'budget'],
      })
      result.current.handleVarListChange([{
        variable: 'city',
        value_selector: ['start', 'city'],
      }])
      result.current.handleVarNameChange('old_name', 'new_name')
      result.current.handleContextVarChange(['start', 'sys.query'])
      result.current.handleContextVarChange([])
      result.current.handlePromptChange([{
        role: PromptRole.system,
        text: 'Updated prompt',
        edition_type: EditionType.basic,
      }])
      result.current.handleSyeQueryChange('{{#sys.query#}}')
      result.current.handleSyeQueryChange('custom query')
      result.current.handleMemoryChange({
        window: {
          enabled: true,
          size: 6,
        },
        query_prompt_template: 'saved memory',
      })
    })

    expect(handleSetInputs).toHaveBeenCalled()
    expect(handleSetInputs.mock.calls[0]![0].prompt_config?.jinja2_variables).toHaveLength(2)
    expect(handleSetInputs.mock.calls[1]![0].prompt_config?.jinja2_variables).toEqual([
      {
        variable: 'old_name',
        value_selector: ['start', 'old_name'],
      },
      {
        variable: '',
        value_selector: [],
      },
      {
        variable: 'budget',
        value_selector: ['start', 'budget'],
      },
    ])
    expect(handleSetInputs.mock.calls[2]![0].prompt_config?.jinja2_variables).toEqual([{
      variable: 'city',
      value_selector: ['start', 'city'],
    }])
    expect((handleSetInputs.mock.calls[3]![0].prompt_template as Array<{
      jinja2_text?: string
    }>)[0]!.jinja2_text).toBe('{{ new_name }}')
    expect(handleSetInputs.mock.calls[4]![0].context).toEqual({
      enabled: true,
      variable_selector: ['start', 'sys.query'],
    })
    expect(handleSetInputs.mock.calls[5]![0].context).toEqual({
      enabled: false,
      variable_selector: [],
    })
    expect(handleSetInputs.mock.calls[6]![0].prompt_template).toEqual([{
      role: PromptRole.system,
      text: 'Updated prompt',
      edition_type: EditionType.basic,
    }])
    expect(handleSetInputs.mock.calls[7]![0].memory).toEqual({
      window: {
        enabled: false,
        size: 10,
      },
      query_prompt_template: '{{#sys.query#}}',
    })
    expect(handleSetInputs.mock.calls[8]![0].memory?.query_prompt_template).toBe('custom query')
    expect(handleSetInputs.mock.calls[9]![0].memory).toEqual({
      window: {
        enabled: true,
        size: 6,
      },
      query_prompt_template: 'saved memory',
    })
  })

  it('handles completion prompt branches, including the non-jinja early return and jinja rename flow', () => {
    const basicInputRef = {
      current: createPayload({
        model: {
          provider: 'openai',
          name: 'gpt-4o-mini',
          mode: AppModeEnum.COMPLETION,
          completion_params: {},
        },
        prompt_template: {
          role: PromptRole.user,
          text: `${CONTEXT_PLACEHOLDER_TEXT} ${HISTORY_PLACEHOLDER_TEXT} ${QUERY_PLACEHOLDER_TEXT}`,
          edition_type: EditionType.basic,
        },
      }),
    } as MutableRefObject<LLMNodeType>
    const handleSetInputs = createSetInputs(basicInputRef)

    const { result } = renderHook(() => useLLMPromptConfig({
      inputs: basicInputRef.current,
      inputRef: basicInputRef,
      isChatMode: true,
      isChatModel: false,
      setInputs: handleSetInputs,
    }))

    expect(result.current.hasSetBlockStatus).toEqual({
      history: true,
      query: true,
      context: true,
    })
    expect(result.current.shouldShowContextTip).toBe(false)
    expect(result.current.isShowVars).toBe(false)

    act(() => {
      result.current.handleVarNameChange('old_name', 'new_name')
    })

    expect(handleSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      prompt_template: expect.objectContaining({
        text: `${CONTEXT_PLACEHOLDER_TEXT} ${HISTORY_PLACEHOLDER_TEXT} ${QUERY_PLACEHOLDER_TEXT}`,
      }),
    }))

    const jinjaInputRef = {
      current: createPayload({
        model: {
          provider: 'openai',
          name: 'gpt-4o-mini',
          mode: AppModeEnum.COMPLETION,
          completion_params: {},
        },
        prompt_template: {
          role: PromptRole.user,
          text: 'Template',
          edition_type: EditionType.jinja2,
          jinja2_text: '{{ old_name }}',
        },
      }),
    } as MutableRefObject<LLMNodeType>
    const handleJinjaInputs = createSetInputs(jinjaInputRef)

    const { result: jinjaResult } = renderHook(() => useLLMPromptConfig({
      inputs: jinjaInputRef.current,
      inputRef: jinjaInputRef,
      isChatMode: false,
      isChatModel: false,
      setInputs: handleJinjaInputs,
    }))

    act(() => {
      jinjaResult.current.handleVarNameChange('old_name', 'budget')
    })

    expect(handleJinjaInputs).toHaveBeenCalledWith(expect.objectContaining({
      prompt_template: expect.objectContaining({
        jinja2_text: '{{ budget }}',
      }),
    }))
  })
})
