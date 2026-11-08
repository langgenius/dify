import type { PropsWithChildren } from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import DebugConfigurationContext from '@/context/debug-configuration'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { PromptMode } from '@/models/debug'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import {
  createDatasetConfigsFixture,
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import { AgentStrategy, RETRIEVE_TYPE } from '@/types/app'
import {
  useConfigFromDebugContext,
  useDebugWithSingleOrMultipleModel,
  useFormattingChangedDispatcher,
  useFormattingChangedSubscription,
} from '../hooks'

describe('configuration debug hooks', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should persist multiple-model debug settings in local storage', () => {
    const { result, unmount } = renderHook(() => useDebugWithSingleOrMultipleModel('app-1'))

    act(() => {
      result.current.handleMultipleModelConfigsChange(true, [
        {
          id: 'model-1',
          model: 'gpt-4o',
          provider: 'langgenius/openai/openai',
          parameters: { temperature: 0.7 },
        },
      ])
    })

    expect(result.current.debugWithMultipleModel).toBe(true)
    expect(result.current.multipleModelConfigs).toHaveLength(1)
    unmount()
    const restored = renderHook(() => useDebugWithSingleOrMultipleModel('app-1'))
    expect(restored.result.current.debugWithMultipleModel).toBe(true)
    expect(restored.result.current.multipleModelConfigs).toEqual([
      {
        id: 'model-1',
        model: 'gpt-4o',
        provider: 'langgenius/openai/openai',
        parameters: { temperature: 0.7 },
      },
    ])
    const otherApp = renderHook(() => useDebugWithSingleOrMultipleModel('app-2'))
    expect(otherApp.result.current.debugWithMultipleModel).toBe(false)
    expect(otherApp.result.current.multipleModelConfigs).toEqual([])
  })

  it.each(['{', 'null'])('should fall back to default settings for stored value %s', (value) => {
    localStorage.setItem('app-debug-with-single-or-multiple-models', value)

    const { result } = renderHook(() => useDebugWithSingleOrMultipleModel('app-1'))

    expect(result.current.debugWithMultipleModel).toBe(false)
    expect(result.current.multipleModelConfigs).toEqual([])
  })

  it('should derive chat config data from the debug context', () => {
    const configuration = createDebugConfigurationFixture({
      isAdvancedMode: false,
      modelConfig: createModelConfigFixture({
        agentConfig: {
          enabled: true,
          max_iteration: 3,
          strategy: AgentStrategy.react,
          tools: [],
        },
        configs: {
          prompt_template: 'hello {{name}}',
          prompt_variables: [{ key: 'name', name: 'Name', type: 'string', required: true }],
        },
        more_like_this: { enabled: true },
      }),
      appId: 'app-1',
      promptMode: PromptMode.simple,
      speechToTextConfig: { enabled: false },
      introduction: 'hello',
      suggestedQuestions: ['how are you?'],
      suggestedQuestionsAfterAnswerConfig: { enabled: false },
      citationConfig: { enabled: true },
      moderationConfig: { enabled: false },
      dataSets: [createDatasetFixture({ id: 'dataset-1' })],
      datasetConfigs: createDatasetConfigsFixture({ retrieval_model: RETRIEVE_TYPE.multiWay }),
      textToSpeechConfig: { enabled: false, voice: '', language: '' },
      isFunctionCall: true,
    })

    const { result } = renderHook(() => useConfigFromDebugContext(), {
      wrapper: ({ children }: PropsWithChildren) => (
        <DebugConfigurationContext.Provider value={configuration}>
          {children}
        </DebugConfigurationContext.Provider>
      ),
    })

    expect(result.current).toEqual(
      expect.objectContaining({
        appId: 'app-1',
        dataset_query_variable: '',
        opening_statement: 'hello',
        pre_prompt: 'hello {{name}}',
        suggested_questions: ['how are you?'],
      }),
    )
    expect(result.current.agent_mode?.strategy).toBe(AgentStrategy.functionCall)
    expect(result.current.dataset_configs?.datasets?.datasets).toEqual([
      { dataset: { enabled: true, id: 'dataset-1' } },
    ])
  })

  it.each([
    { hasAnswer: true, initiallyChanged: false, expected: 'Refresh required' },
    { hasAnswer: false, initiallyChanged: false, expected: 'Up to date' },
    { hasAnswer: true, initiallyChanged: true, expected: 'Refresh required' },
  ])(
    'updates formatting state for the current conversation: %j',
    async ({ hasAnswer, initiallyChanged, expected }) => {
      function Conversation() {
        const dispatch = useFormattingChangedDispatcher()
        useFormattingChangedSubscription([
          { id: 'message-1', content: 'Hello', isAnswer: hasAnswer },
        ])
        return <button onClick={dispatch}>Change configuration</button>
      }
      function Session() {
        const [formattingChanged, setFormattingChanged] = useState(initiallyChanged)
        return (
          <DebugConfigurationContext.Provider
            value={createDebugConfigurationFixture({ formattingChanged, setFormattingChanged })}
          >
            <Conversation />
            <output>{formattingChanged ? 'Refresh required' : 'Up to date'}</output>
          </DebugConfigurationContext.Provider>
        )
      }
      const user = userEvent.setup()
      render(
        <EventEmitterContextProvider>
          <Session />
        </EventEmitterContextProvider>,
      )
      expect(screen.getByRole('status')).toHaveTextContent(
        initiallyChanged ? 'Refresh required' : 'Up to date',
      )
      await user.click(screen.getByRole('button', { name: 'Change configuration' }))
      expect(screen.getByRole('status')).toHaveTextContent(expected)
    },
  )
})
