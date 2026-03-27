import type { PromptItem } from '@/models/debug'
import { act, renderHook } from '@testing-library/react'
import { PromptMode } from '@/models/debug'
import { fetchPromptTemplate } from '@/service/debug'
import { AppModeEnum, ModelModeType } from '@/types/app'
import useAdvancedPromptConfig from '../use-advanced-prompt-config'

const mockFetchPromptTemplate = vi.mocked(fetchPromptTemplate)

vi.mock('@/service/debug', () => ({
  fetchPromptTemplate: vi.fn(),
}))

describe('useAdvancedPromptConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchPromptTemplate.mockResolvedValue({
      chat_prompt_config: {
        prompt: [
          { text: 'context {{#pre_prompt#}}' },
        ],
      },
      completion_prompt_config: {
        prompt: {
          text: 'completion {{#pre_prompt#}}',
        },
        conversation_histories_role: {
          user_prefix: 'User',
          assistant_prefix: 'Assistant',
        },
      },
      stop: ['END'],
    } as Awaited<ReturnType<typeof fetchPromptTemplate>>)
  })

  const renderAdvancedPromptHook = (overrides: Partial<Parameters<typeof useAdvancedPromptConfig>[0]> = {}) => {
    const setCompletionParams = vi.fn()
    const setStop = vi.fn()
    const onUserChangedPrompt = vi.fn()

    const hook = renderHook(() => useAdvancedPromptConfig({
      appMode: AppModeEnum.CHAT,
      modelModeType: ModelModeType.chat,
      modelName: 'gpt-4o',
      promptMode: PromptMode.advanced,
      prePrompt: 'prefill',
      onUserChangedPrompt,
      hasSetDataSet: false,
      completionParams: {},
      setCompletionParams,
      setStop,
      ...overrides,
    }))

    return {
      ...hook,
      onUserChangedPrompt,
      setCompletionParams,
      setStop,
    }
  }

  // Covers prompt state setters for advanced mode.
  describe('prompt state', () => {
    it('should update the current advanced prompt and notify when the user changed it', () => {
      const prompt: PromptItem[] = [{ text: 'updated prompt' }]
      const { result, onUserChangedPrompt } = renderAdvancedPromptHook()

      act(() => {
        result.current.setCurrentAdvancedPrompt(prompt, true)
      })

      expect(result.current.currentAdvancedPrompt).toEqual(prompt)
      expect(onUserChangedPrompt).toHaveBeenCalledTimes(1)
    })

    it('should update completion prompts, history role, and block status in completion mode', () => {
      const { result } = renderAdvancedPromptHook({
        modelModeType: ModelModeType.completion,
      })

      act(() => {
        result.current.setCurrentAdvancedPrompt({ text: '{{#context#}}{{#histories#}}{{#query#}}' }, true)
      })

      act(() => {
        result.current.setConversationHistoriesRole({
          user_prefix: 'User:',
          assistant_prefix: 'Assistant:',
        })
      })

      expect(result.current.completionPromptConfig.prompt.text).toBe('{{#context#}}{{#histories#}}{{#query#}}')
      expect(result.current.completionPromptConfig.conversation_histories_role).toEqual({
        user_prefix: 'User:',
        assistant_prefix: 'Assistant:',
      })
      expect(result.current.hasSetBlockStatus).toEqual({
        context: true,
        history: true,
        query: true,
      })
    })

    it('should no-op advanced prompt setters when the prompt mode is simple', () => {
      const { result, onUserChangedPrompt } = renderAdvancedPromptHook({
        promptMode: PromptMode.simple,
        prePrompt: '{{#context#}}',
      })

      act(() => {
        result.current.setCurrentAdvancedPrompt([{ text: 'ignored' }], true)
      })

      expect(result.current.currentAdvancedPrompt).toEqual([])
      expect(result.current.hasSetBlockStatus).toEqual({
        context: true,
        history: false,
        query: false,
      })
      expect(onUserChangedPrompt).not.toHaveBeenCalled()
    })
  })

  // Covers default prompt migration for simple-mode chat apps.
  describe('default prompt migration', () => {
    it('should fetch and hydrate the default chat prompt when upgrading from simple mode', async () => {
      const { result } = renderAdvancedPromptHook({
        promptMode: PromptMode.simple,
      })

      await act(async () => {
        await result.current.migrateToDefaultPrompt()
      })

      expect(mockFetchPromptTemplate).toHaveBeenCalledWith({
        appMode: AppModeEnum.CHAT,
        mode: ModelModeType.chat,
        modelName: 'gpt-4o',
        hasSetDataSet: false,
      })
      expect(result.current.chatPromptConfig.prompt[0].text).toBe('context prefill')
    })

    it('should hydrate completion prompts when upgrading a simple completion app', async () => {
      const { result, setCompletionParams } = renderAdvancedPromptHook({
        promptMode: PromptMode.simple,
        modelModeType: ModelModeType.completion,
        completionParams: { temperature: 0.7 },
      })

      await act(async () => {
        await result.current.migrateToDefaultPrompt()
      })

      expect(result.current.completionPromptConfig.prompt.text).toBe('completion prefill')
      expect(setCompletionParams).toHaveBeenCalledWith({
        temperature: 0.7,
        stop: ['END'],
      })
    })

    it('should migrate to completion prompts and propagate stop words when switching modes', async () => {
      const { result, setCompletionParams, setStop } = renderAdvancedPromptHook({
        modelModeType: ModelModeType.chat,
        appMode: AppModeEnum.ADVANCED_CHAT,
        completionParams: { stop: [] },
      })

      await act(async () => {
        await result.current.migrateToDefaultPrompt(true, ModelModeType.completion)
      })

      expect(result.current.completionPromptConfig.prompt.text).toBe('completion prefill')
      expect(setCompletionParams).toHaveBeenCalledWith({
        stop: ['END'],
      })
      expect(setStop).toHaveBeenCalledWith(['END'])
    })

    it('should preserve existing completion prompt text and stop words when migrating advanced prompts', async () => {
      const { result, setCompletionParams, setStop } = renderAdvancedPromptHook({
        modelModeType: ModelModeType.chat,
        appMode: AppModeEnum.AGENT_CHAT,
        completionParams: { stop: ['KEEP'] },
      })

      act(() => {
        result.current.setCompletionPromptConfig({
          prompt: { text: 'kept {{#pre_prompt#}}' },
          conversation_histories_role: {
            user_prefix: 'User',
            assistant_prefix: 'Assistant',
          },
        })
      })

      await act(async () => {
        await result.current.migrateToDefaultPrompt(true, ModelModeType.completion)
      })

      expect(result.current.completionPromptConfig.prompt.text).toBe('kept prefill')
      expect(result.current.completionPromptConfig.conversation_histories_role).toEqual({
        user_prefix: 'User',
        assistant_prefix: 'Assistant',
      })
      expect(setCompletionParams).not.toHaveBeenCalled()
      expect(setStop).toHaveBeenCalledWith(['END'])
    })

    it('should migrate advanced prompts back to chat mode and skip migration when app mode is missing', async () => {
      const { result } = renderAdvancedPromptHook({
        appMode: undefined,
      })

      await act(async () => {
        await result.current.migrateToDefaultPrompt()
      })

      expect(mockFetchPromptTemplate).not.toHaveBeenCalled()

      const advancedResult = renderAdvancedPromptHook({
        modelModeType: ModelModeType.completion,
      })

      await act(async () => {
        await advancedResult.result.current.migrateToDefaultPrompt(true, ModelModeType.chat)
      })

      expect(advancedResult.result.current.chatPromptConfig.prompt[0].text).toBe('context prefill')
    })
  })
})
