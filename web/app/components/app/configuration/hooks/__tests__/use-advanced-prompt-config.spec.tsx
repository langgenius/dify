/* eslint-disable ts/no-explicit-any */
import { act, renderHook, waitFor } from '@testing-library/react'
import { CONTEXT_PLACEHOLDER_TEXT, HISTORY_PLACEHOLDER_TEXT, PRE_PROMPT_PLACEHOLDER_TEXT, QUERY_PLACEHOLDER_TEXT } from '@/app/components/base/prompt-editor/constants'
import { PromptMode, PromptRole } from '@/models/debug'
import { fetchPromptTemplate } from '@/service/debug'
import { AppModeEnum, ModelModeType } from '@/types/app'
import useAdvancedPromptConfig from '../use-advanced-prompt-config'

vi.mock('@/service/debug', () => ({
  fetchPromptTemplate: vi.fn(),
}))

const mockFetchPromptTemplate = vi.mocked(fetchPromptTemplate)

describe('useAdvancedPromptConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update the advanced chat prompt and mark user changes', () => {
    const handleUserChangedPrompt = vi.fn()
    const { result } = renderHook(() => useAdvancedPromptConfig({
      appMode: AppModeEnum.CHAT,
      modelModeType: ModelModeType.chat,
      modelName: 'gpt-4o',
      promptMode: PromptMode.advanced,
      prePrompt: '',
      onUserChangedPrompt: handleUserChangedPrompt,
      hasSetDataSet: false,
      completionParams: {},
      setCompletionParams: vi.fn(),
      setStop: vi.fn(),
    }))

    act(() => {
      result.current.setCurrentAdvancedPrompt([{ role: PromptRole.system, text: `hello ${QUERY_PLACEHOLDER_TEXT}` }], true)
    })

    expect(result.current.currentAdvancedPrompt).toEqual([{ role: PromptRole.system, text: `hello ${QUERY_PLACEHOLDER_TEXT}` }])
    expect(result.current.hasSetBlockStatus.query).toBe(true)
    expect(handleUserChangedPrompt).toHaveBeenCalledTimes(1)
  })

  it('should derive simple prompt block status from the pre-prompt', () => {
    const { result } = renderHook(() => useAdvancedPromptConfig({
      appMode: AppModeEnum.COMPLETION,
      modelModeType: ModelModeType.completion,
      modelName: 'gpt-4o',
      promptMode: PromptMode.simple,
      prePrompt: `${CONTEXT_PLACEHOLDER_TEXT} ${QUERY_PLACEHOLDER_TEXT}`,
      onUserChangedPrompt: vi.fn(),
      hasSetDataSet: false,
      completionParams: {},
      setCompletionParams: vi.fn(),
      setStop: vi.fn(),
    }))

    expect(result.current.hasSetBlockStatus).toEqual({
      context: true,
      history: false,
      query: false,
    })
  })

  it('should ignore advanced prompt mutations when the prompt mode is simple', () => {
    const handleUserChangedPrompt = vi.fn()
    const { result } = renderHook(() => useAdvancedPromptConfig({
      appMode: AppModeEnum.CHAT,
      modelModeType: ModelModeType.chat,
      modelName: 'gpt-4o',
      promptMode: PromptMode.simple,
      prePrompt: '',
      onUserChangedPrompt: handleUserChangedPrompt,
      hasSetDataSet: false,
      completionParams: {},
      setCompletionParams: vi.fn(),
      setStop: vi.fn(),
    }))

    act(() => {
      result.current.setCurrentAdvancedPrompt([{ role: PromptRole.system, text: 'ignored' }], true)
    })

    expect(result.current.currentAdvancedPrompt).toEqual([])
    expect(handleUserChangedPrompt).not.toHaveBeenCalled()
  })

  it('should migrate a simple completion prompt to the default template and copy stop words', async () => {
    const setCompletionParams = vi.fn()
    mockFetchPromptTemplate.mockResolvedValue({
      chat_prompt_config: { prompt: [{ role: 'system', text: PRE_PROMPT_PLACEHOLDER_TEXT }] },
      completion_prompt_config: {
        prompt: {
          text: `before ${PRE_PROMPT_PLACEHOLDER_TEXT} after`,
        },
        conversation_histories_role: {
          user_prefix: '',
          assistant_prefix: '',
        },
      },
      stop: ['END'],
    } as any)

    const { result } = renderHook(() => useAdvancedPromptConfig({
      appMode: AppModeEnum.COMPLETION,
      modelModeType: ModelModeType.completion,
      modelName: 'gpt-4o',
      promptMode: PromptMode.simple,
      prePrompt: 'custom prompt',
      onUserChangedPrompt: vi.fn(),
      hasSetDataSet: true,
      completionParams: { temperature: 0.7 },
      setCompletionParams,
      setStop: vi.fn(),
    }))

    await act(async () => {
      await result.current.migrateToDefaultPrompt()
    })

    await waitFor(() => {
      expect(mockFetchPromptTemplate).toHaveBeenCalledWith({
        appMode: AppModeEnum.COMPLETION,
        mode: ModelModeType.completion,
        modelName: 'gpt-4o',
        hasSetDataSet: true,
      })
    })

    expect(result.current.completionPromptConfig.prompt.text).toBe('before custom prompt after')
    expect(setCompletionParams).toHaveBeenCalledWith({
      temperature: 0.7,
      stop: ['END'],
    })
  })

  it('should migrate a simple chat prompt template and replace the pre-prompt placeholder', async () => {
    mockFetchPromptTemplate.mockResolvedValue({
      chat_prompt_config: {
        prompt: [{ role: PromptRole.system, text: `hello ${PRE_PROMPT_PLACEHOLDER_TEXT}` }],
      },
      completion_prompt_config: {
        prompt: { text: PRE_PROMPT_PLACEHOLDER_TEXT },
        conversation_histories_role: {
          user_prefix: '',
          assistant_prefix: '',
        },
      },
      stop: [],
    } as any)

    const { result } = renderHook(() => useAdvancedPromptConfig({
      appMode: AppModeEnum.CHAT,
      modelModeType: ModelModeType.chat,
      modelName: 'gpt-4o',
      promptMode: PromptMode.simple,
      prePrompt: 'system prompt',
      onUserChangedPrompt: vi.fn(),
      hasSetDataSet: false,
      completionParams: {},
      setCompletionParams: vi.fn(),
      setStop: vi.fn(),
    }))

    await act(async () => {
      await result.current.migrateToDefaultPrompt()
    })

    expect(result.current.chatPromptConfig.prompt).toEqual([
      { role: PromptRole.system, text: 'hello system prompt' },
    ])
  })

  it('should migrate an advanced completion prompt when switching from chat mode', async () => {
    const setCompletionParams = vi.fn()
    const setStop = vi.fn()
    mockFetchPromptTemplate.mockResolvedValue({
      chat_prompt_config: {
        prompt: [{ role: PromptRole.system, text: `chat ${PRE_PROMPT_PLACEHOLDER_TEXT}` }],
      },
      completion_prompt_config: {
        prompt: {
          text: `history ${PRE_PROMPT_PLACEHOLDER_TEXT}`,
        },
        conversation_histories_role: {
          user_prefix: 'user:',
          assistant_prefix: 'assistant:',
        },
      },
      stop: ['DONE'],
    } as any)

    const { result } = renderHook(() => useAdvancedPromptConfig({
      appMode: AppModeEnum.CHAT,
      modelModeType: ModelModeType.completion,
      modelName: 'gpt-4o',
      promptMode: PromptMode.advanced,
      prePrompt: `${HISTORY_PLACEHOLDER_TEXT} prompt`,
      onUserChangedPrompt: vi.fn(),
      hasSetDataSet: false,
      completionParams: {},
      setCompletionParams,
      setStop,
    }))

    act(() => {
      result.current.setCurrentAdvancedPrompt({
        text: `override ${PRE_PROMPT_PLACEHOLDER_TEXT}`,
      })
      result.current.setConversationHistoriesRole({
        user_prefix: 'me:',
        assistant_prefix: 'bot:',
      })
    })

    await act(async () => {
      await result.current.migrateToDefaultPrompt(true, ModelModeType.completion)
    })

    expect(result.current.completionPromptConfig.prompt.text).toBe(`history ${HISTORY_PLACEHOLDER_TEXT} prompt`)
    expect(result.current.completionPromptConfig.conversation_histories_role).toEqual({
      user_prefix: 'me:',
      assistant_prefix: 'bot:',
    })
    expect(setCompletionParams).toHaveBeenCalledWith({
      stop: ['DONE'],
    })
    expect(setStop).toHaveBeenCalledWith(['DONE'])
  })

  it('should migrate an advanced prompt back to chat mode when the target model is chat', async () => {
    mockFetchPromptTemplate.mockResolvedValue({
      chat_prompt_config: {
        prompt: [{ role: 'system', text: `chat ${PRE_PROMPT_PLACEHOLDER_TEXT}` }],
      },
      completion_prompt_config: {
        prompt: { text: 'unused' },
        conversation_histories_role: {
          user_prefix: '',
          assistant_prefix: '',
        },
      },
      stop: [],
    } as any)

    const { result } = renderHook(() => useAdvancedPromptConfig({
      appMode: AppModeEnum.COMPLETION,
      modelModeType: ModelModeType.completion,
      modelName: 'gpt-4o',
      promptMode: PromptMode.advanced,
      prePrompt: 'converted prompt',
      onUserChangedPrompt: vi.fn(),
      hasSetDataSet: false,
      completionParams: { stop: ['KEEP'] },
      setCompletionParams: vi.fn(),
      setStop: vi.fn(),
    }))

    await act(async () => {
      await result.current.migrateToDefaultPrompt(true, ModelModeType.chat)
    })

    expect(result.current.chatPromptConfig.prompt).toEqual([
      { role: 'system', text: 'chat converted prompt' },
    ])
  })

  it('should exit early when no app mode is provided', async () => {
    const { result } = renderHook(() => useAdvancedPromptConfig({
      appMode: undefined,
      modelModeType: ModelModeType.chat,
      modelName: 'gpt-4o',
      promptMode: PromptMode.simple,
      prePrompt: '',
      onUserChangedPrompt: vi.fn(),
      hasSetDataSet: false,
      completionParams: {},
      setCompletionParams: vi.fn(),
      setStop: vi.fn(),
    }))

    await act(async () => {
      await result.current.migrateToDefaultPrompt()
    })

    expect(mockFetchPromptTemplate).not.toHaveBeenCalled()
  })
})
