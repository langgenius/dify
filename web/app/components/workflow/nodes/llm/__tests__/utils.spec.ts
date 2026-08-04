import type { EnvironmentVariable, ModelConfig } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import {
  getLLMEnvironmentModel,
  getLLMModelIssue,
  isEnvironmentModelSource,
  isLLMModelProviderInstalled,
  LLMModelIssueCode,
  resolveLLMNodeModel,
} from '../utils'

describe('llm utils', () => {
  describe('getLLMModelIssue', () => {
    it('returns provider-required when the model provider is missing', () => {
      expect(getLLMModelIssue({ modelProvider: undefined })).toBe(
        LLMModelIssueCode.providerRequired,
      )
    })

    it('returns provider-plugin-unavailable when the provider plugin is not installed', () => {
      expect(
        getLLMModelIssue({
          modelProvider: 'langgenius/openai/gpt-4.1',
          isModelProviderInstalled: false,
        }),
      ).toBe(LLMModelIssueCode.providerPluginUnavailable)
    })

    it('returns null when the provider is present and installed', () => {
      expect(
        getLLMModelIssue({
          modelProvider: 'langgenius/openai/gpt-4.1',
          isModelProviderInstalled: true,
        }),
      ).toBeNull()
    })
  })

  describe('isLLMModelProviderInstalled', () => {
    it('returns true when the model provider is missing', () => {
      expect(isLLMModelProviderInstalled(undefined, new Set())).toBe(true)
    })

    it('matches installed plugin ids using the provider plugin prefix', () => {
      expect(
        isLLMModelProviderInstalled('langgenius/openai/gpt-4.1', new Set(['langgenius/openai'])),
      ).toBe(true)
    })

    it('returns false when the provider plugin id is not installed', () => {
      expect(
        isLLMModelProviderInstalled('langgenius/openai/gpt-4.1', new Set(['langgenius/anthropic'])),
      ).toBe(false)
    })
  })

  describe('environment model resolution', () => {
    const model: ModelConfig = {
      provider: 'direct-provider',
      name: 'direct-model',
      mode: AppModeEnum.CHAT,
      completion_params: { temperature: 0.3 },
    }
    const environmentVariables: EnvironmentVariable[] = [
      {
        id: 'env-1',
        name: 'for_summarize',
        value_type: 'llm',
        value: {
          provider: 'shared-provider',
          name: 'shared-model',
          mode: AppModeEnum.CHAT,
          completion_params: { temperature: 0.8 },
        },
        description: '',
      },
    ]

    it('uses shared completion params while resolving the shared model', () => {
      expect(resolveLLMNodeModel(model, ['env', 'for_summarize'], environmentVariables)).toEqual({
        provider: 'shared-provider',
        name: 'shared-model',
        mode: AppModeEnum.CHAT,
        completion_params: { temperature: 0.8 },
      })
    })

    it('keeps node completion params for a legacy shared model without params', () => {
      const legacyEnvironmentVariables = [
        {
          ...environmentVariables[0],
          value: {
            provider: 'shared-provider',
            name: 'shared-model',
            mode: AppModeEnum.CHAT,
          },
        },
      ] as EnvironmentVariable[]

      expect(
        resolveLLMNodeModel(model, ['env', 'for_summarize'], legacyEnvironmentVariables),
      ).toEqual({
        provider: 'shared-provider',
        name: 'shared-model',
        mode: AppModeEnum.CHAT,
        completion_params: { temperature: 0.3 },
      })
    })

    it('returns the environment identity for initial binding before the node mode is updated', () => {
      const completionModelVariables = [
        {
          ...environmentVariables[0],
          value: {
            provider: 'shared-provider',
            name: 'shared-completion-model',
            mode: AppModeEnum.COMPLETION,
            completion_params: { temperature: 0.8 },
          },
        },
      ] as EnvironmentVariable[]

      expect(getLLMEnvironmentModel(['env', 'for_summarize'], completionModelVariables)).toEqual({
        provider: 'shared-provider',
        name: 'shared-completion-model',
        mode: AppModeEnum.COMPLETION,
        completion_params: { temperature: 0.8 },
      })
    })

    it('rejects a live reference when its mode no longer matches the stored node mode', () => {
      const changedModeVariables = [
        {
          ...environmentVariables[0],
          value: {
            provider: 'shared-provider',
            name: 'shared-model',
            mode: AppModeEnum.COMPLETION,
          },
        },
      ] as EnvironmentVariable[]

      expect(
        resolveLLMNodeModel(model, ['env', 'for_summarize'], changedModeVariables),
      ).toBeUndefined()
    })

    it('returns undefined for a missing or non-LLM environment variable', () => {
      expect(resolveLLMNodeModel(model, ['env', 'missing'], environmentVariables)).toBeUndefined()
      expect(
        resolveLLMNodeModel(model, ['env', 'for_summarize'], [
          { ...environmentVariables[0], value_type: 'string' },
        ] as EnvironmentVariable[]),
      ).toBeUndefined()
    })

    it('keeps the static model for a legacy non-environment selector', () => {
      const selector = ['start', 'MODEL_NAME']

      expect(isEnvironmentModelSource(selector)).toBe(false)
      expect(resolveLLMNodeModel(model, selector, environmentVariables)).toBe(model)
    })
  })
})
