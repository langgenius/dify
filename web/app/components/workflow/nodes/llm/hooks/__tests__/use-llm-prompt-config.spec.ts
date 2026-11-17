import type { LLMNodeType } from '../../types'
import { act, renderHook } from '@testing-library/react'
import { useRef, useState } from 'react'
import {
  CONTEXT_PLACEHOLDER_TEXT,
  HISTORY_PLACEHOLDER_TEXT,
  QUERY_PLACEHOLDER_TEXT,
} from '@/app/components/base/prompt-editor/constants'
import { BlockEnum, EditionType, PromptRole, VarType } from '@/app/components/workflow/types'
import useLLMPromptConfig from '../use-llm-prompt-config'

const createPayload = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  type: BlockEnum.LLM,
  title: 'LLM',
  desc: '',
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat' as const,
    completion_params: {},
  },
  prompt_template: [
    {
      role: PromptRole.system,
      text: 'Base prompt',
      edition_type: EditionType.basic,
    },
  ],
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

const renderConfig = (initial = createPayload(), isChatflow = true, isChatModel = true) =>
  renderHook(() => {
    const [inputs, updateInputs] = useState(initial)
    const inputRef = useRef(inputs)
    const config = useLLMPromptConfig({
      inputs,
      inputRef,
      isChatflow,
      isChatModel,
      setInputs: (next) => {
        inputRef.current = next
        updateInputs(next)
      },
    })
    return { ...config, inputs }
  })

const jinjaPrompt = {
  role: PromptRole.user,
  text: 'Template',
  edition_type: EditionType.jinja2,
  jinja2_text: '{{ old_name }} and {{ old_name }}',
}

describe('useLLMPromptConfig', () => {
  it.each([undefined, {}] as const)(
    'initializes incomplete prompt config %j when adding a variable',
    (promptConfig) => {
      const { result } = renderConfig(
        createPayload({ prompt_config: promptConfig as LLMNodeType['prompt_config'] }),
      )
      act(() =>
        result.current.handleAddVariable({
          variable: 'budget',
          value_selector: ['start', 'budget'],
        }),
      )
      expect(result.current.inputs.prompt_config?.jinja2_variables).toEqual([
        { variable: 'budget', value_selector: ['start', 'budget'] },
      ])
    },
  )

  it('adds and replaces variables without losing other prompt configuration', () => {
    const { result } = renderConfig()
    act(() => result.current.handleAddEmptyVariable())
    expect(result.current.inputs.prompt_config?.jinja2_variables).toEqual([
      { variable: '', value_selector: [] },
    ])
    act(() =>
      result.current.handleAddVariable({ variable: 'budget', value_selector: ['start', 'budget'] }),
    )
    expect(result.current.inputs.prompt_config?.jinja2_variables).toEqual([
      { variable: '', value_selector: [] },
      { variable: 'budget', value_selector: ['start', 'budget'] },
    ])
    act(() =>
      result.current.handleVarListChange([{ variable: 'city', value_selector: ['start', 'city'] }]),
    )
    expect(result.current.inputs.prompt_config?.jinja2_variables).toEqual([
      { variable: 'city', value_selector: ['start', 'city'] },
    ])
    expect(result.current.inputs.model).toEqual(createPayload().model)
    expect(result.current.inputs.prompt_template).toEqual(createPayload().prompt_template)
  })

  it.each([true, false])(
    'renames all Jinja references in chat-model=%s without changing basic prompts',
    (isChatModel) => {
      const basicPrompt = {
        role: PromptRole.system,
        text: '{{ old_name }}',
        edition_type: EditionType.basic,
      }
      const original = createPayload({
        prompt_template: isChatModel ? [basicPrompt, jinjaPrompt] : jinjaPrompt,
      })
      const { result } = renderConfig(original, false, isChatModel)
      act(() => result.current.handleVarNameChange('old_name', 'new_name'))
      expect(result.current.inputs.prompt_template).toEqual(
        isChatModel
          ? [basicPrompt, { ...jinjaPrompt, jinja2_text: '{{ new_name }} and {{ new_name }}' }]
          : { ...jinjaPrompt, jinja2_text: '{{ new_name }} and {{ new_name }}' },
      )
      expect(jinjaPrompt.jinja2_text).toBe('{{ old_name }} and {{ old_name }}')
    },
  )

  it('updates context guidance and variable visibility when the prompt changes', () => {
    const { result } = renderConfig(createPayload({ prompt_template: [jinjaPrompt] }))
    expect(result.current.isShowVars).toBe(true)
    act(() => result.current.handleContextVarChange(['start', 'query']))
    expect(result.current.inputs.context).toEqual({
      enabled: true,
      variable_selector: ['start', 'query'],
    })
    expect(result.current.shouldShowContextTip).toBe(true)
    act(() =>
      result.current.handlePromptChange([
        {
          role: PromptRole.system,
          text: `${CONTEXT_PLACEHOLDER_TEXT} ${QUERY_PLACEHOLDER_TEXT}`,
          edition_type: EditionType.basic,
        },
      ]),
    )
    expect(result.current.shouldShowContextTip).toBe(false)
    expect(result.current.isShowVars).toBe(false)
    expect(result.current.hasSetBlockStatus).toEqual({ history: false, query: true, context: true })
    act(() => result.current.handleContextVarChange([]))
    expect(result.current.inputs.context).toEqual({ enabled: false, variable_selector: [] })
  })

  it.each([true, false])('reports completion prompt blocks for chatflow=%s', (isChatflow) => {
    const template = {
      role: PromptRole.user,
      text: `${CONTEXT_PLACEHOLDER_TEXT} ${HISTORY_PLACEHOLDER_TEXT} ${QUERY_PLACEHOLDER_TEXT}`,
      edition_type: EditionType.basic,
    }
    const { result } = renderConfig(createPayload({ prompt_template: template }), isChatflow, false)
    expect(result.current.hasSetBlockStatus).toEqual({
      history: isChatflow,
      query: isChatflow,
      context: true,
    })
    act(() => result.current.handleVarNameChange('old_name', 'new_name'))
    expect(result.current.inputs.prompt_template).toEqual(template)
  })

  it('initializes memory and preserves its window when changing the query', () => {
    const { result } = renderConfig()
    act(() => result.current.handleSyeQueryChange('{{#sys.query#}}'))
    expect(result.current.inputs.memory).toEqual({
      window: { enabled: false, size: 10 },
      query_prompt_template: '{{#sys.query#}}',
    })
    act(() =>
      result.current.handleMemoryChange({
        window: { enabled: true, size: 6 },
        query_prompt_template: 'saved memory',
      }),
    )
    act(() => result.current.handleSyeQueryChange('custom query'))
    expect(result.current.inputs.memory).toEqual({
      window: { enabled: true, size: 6 },
      query_prompt_template: 'custom query',
    })
  })

  it.each([
    [VarType.string, true, true, true],
    [VarType.boolean, false, true, false],
    [VarType.object, false, true, false],
    [VarType.file, true, false, true],
    [VarType.arrayObject, false, true, true],
  ] as const)('filters %s for basic, Jinja and memory prompts', (type, basic, jinja, memory) => {
    const { result } = renderConfig()
    const variable = { variable: 'value', type }
    expect(result.current.filterInputVar(variable)).toBe(basic)
    expect(result.current.filterJinja2InputVar(variable)).toBe(jinja)
    expect(result.current.filterVar(variable)).toBe(memory)
  })
})
