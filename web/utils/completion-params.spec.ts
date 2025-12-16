import { mergeValidCompletionParams } from './completion-params'
import type { FormValue, ModelParameterRule } from '@/app/components/header/account-setting/model-provider-page/declarations'

describe('completion-params', () => {
  describe('mergeValidCompletionParams', () => {
    test('returns empty params and removedDetails for undefined oldParams', () => {
      const rules: ModelParameterRule[] = []
      const result = mergeValidCompletionParams(undefined, rules)

      expect(result.params).toEqual({})
      expect(result.removedDetails).toEqual({})
    })

    test('returns empty params and removedDetails for empty oldParams', () => {
      const rules: ModelParameterRule[] = []
      const result = mergeValidCompletionParams({}, rules)

      expect(result.params).toEqual({})
      expect(result.removedDetails).toEqual({})
    })

    test('validates int type parameter within range', () => {
      const rules: ModelParameterRule[] = [
        { name: 'max_tokens', type: 'int', min: 1, max: 4096, label: { en_US: 'Max Tokens', zh_Hans: '最大标记' }, required: false },
      ]
      const oldParams: FormValue = { max_tokens: 100 }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({ max_tokens: 100 })
      expect(result.removedDetails).toEqual({})
    })

    test('removes int parameter below minimum', () => {
      const rules: ModelParameterRule[] = [
        { name: 'max_tokens', type: 'int', min: 1, max: 4096, label: { en_US: 'Max Tokens', zh_Hans: '最大标记' }, required: false },
      ]
      const oldParams: FormValue = { max_tokens: 0 }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({})
      expect(result.removedDetails).toEqual({ max_tokens: 'out of range (1-4096)' })
    })

    test('removes int parameter above maximum', () => {
      const rules: ModelParameterRule[] = [
        { name: 'max_tokens', type: 'int', min: 1, max: 4096, label: { en_US: 'Max Tokens', zh_Hans: '最大标记' }, required: false },
      ]
      const oldParams: FormValue = { max_tokens: 5000 }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({})
      expect(result.removedDetails).toEqual({ max_tokens: 'out of range (1-4096)' })
    })

    test('removes int parameter with invalid type', () => {
      const rules: ModelParameterRule[] = [
        { name: 'max_tokens', type: 'int', min: 1, max: 4096, label: { en_US: 'Max Tokens', zh_Hans: '最大标记' }, required: false },
      ]
      const oldParams: FormValue = { max_tokens: 'not a number' as any }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({})
      expect(result.removedDetails).toEqual({ max_tokens: 'invalid type' })
    })

    test('validates float type parameter', () => {
      const rules: ModelParameterRule[] = [
        { name: 'temperature', type: 'float', min: 0, max: 2, label: { en_US: 'Temperature', zh_Hans: '温度' }, required: false },
      ]
      const oldParams: FormValue = { temperature: 0.7 }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({ temperature: 0.7 })
      expect(result.removedDetails).toEqual({})
    })

    test('validates float at boundary values', () => {
      const rules: ModelParameterRule[] = [
        { name: 'temperature', type: 'float', min: 0, max: 2, label: { en_US: 'Temperature', zh_Hans: '温度' }, required: false },
      ]

      const result1 = mergeValidCompletionParams({ temperature: 0 }, rules)
      expect(result1.params).toEqual({ temperature: 0 })

      const result2 = mergeValidCompletionParams({ temperature: 2 }, rules)
      expect(result2.params).toEqual({ temperature: 2 })
    })

    test('validates boolean type parameter', () => {
      const rules: ModelParameterRule[] = [
        { name: 'stream', type: 'boolean', label: { en_US: 'Stream', zh_Hans: '流' }, required: false },
      ]
      const oldParams: FormValue = { stream: true }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({ stream: true })
      expect(result.removedDetails).toEqual({})
    })

    test('removes boolean parameter with invalid type', () => {
      const rules: ModelParameterRule[] = [
        { name: 'stream', type: 'boolean', label: { en_US: 'Stream', zh_Hans: '流' }, required: false },
      ]
      const oldParams: FormValue = { stream: 'yes' as any }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({})
      expect(result.removedDetails).toEqual({ stream: 'invalid type' })
    })

    test('validates string type parameter', () => {
      const rules: ModelParameterRule[] = [
        { name: 'model', type: 'string', label: { en_US: 'Model', zh_Hans: '模型' }, required: false },
      ]
      const oldParams: FormValue = { model: 'gpt-4' }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({ model: 'gpt-4' })
      expect(result.removedDetails).toEqual({})
    })

    test('validates string parameter with options', () => {
      const rules: ModelParameterRule[] = [
        { name: 'model', type: 'string', options: ['gpt-3.5-turbo', 'gpt-4'], label: { en_US: 'Model', zh_Hans: '模型' }, required: false },
      ]
      const oldParams: FormValue = { model: 'gpt-4' }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({ model: 'gpt-4' })
      expect(result.removedDetails).toEqual({})
    })

    test('removes string parameter with invalid option', () => {
      const rules: ModelParameterRule[] = [
        { name: 'model', type: 'string', options: ['gpt-3.5-turbo', 'gpt-4'], label: { en_US: 'Model', zh_Hans: '模型' }, required: false },
      ]
      const oldParams: FormValue = { model: 'invalid-model' }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({})
      expect(result.removedDetails).toEqual({ model: 'unsupported option' })
    })

    test('validates text type parameter', () => {
      const rules: ModelParameterRule[] = [
        { name: 'prompt', type: 'text', label: { en_US: 'Prompt', zh_Hans: '提示' }, required: false },
      ]
      const oldParams: FormValue = { prompt: 'Hello world' }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({ prompt: 'Hello world' })
      expect(result.removedDetails).toEqual({})
    })

    test('removes unsupported parameters', () => {
      const rules: ModelParameterRule[] = [
        { name: 'temperature', type: 'float', min: 0, max: 2, label: { en_US: 'Temperature', zh_Hans: '温度' }, required: false },
      ]
      const oldParams: FormValue = { temperature: 0.7, unsupported_param: 'value' }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({ temperature: 0.7 })
      expect(result.removedDetails).toEqual({ unsupported_param: 'unsupported' })
    })

    test('keeps stop parameter in advanced mode even without rule', () => {
      const rules: ModelParameterRule[] = []
      const oldParams: FormValue = { stop: ['END'] }
      const result = mergeValidCompletionParams(oldParams, rules, true)

      expect(result.params).toEqual({ stop: ['END'] })
      expect(result.removedDetails).toEqual({})
    })

    test('removes stop parameter in normal mode without rule', () => {
      const rules: ModelParameterRule[] = []
      const oldParams: FormValue = { stop: ['END'] }
      const result = mergeValidCompletionParams(oldParams, rules, false)

      expect(result.params).toEqual({})
      expect(result.removedDetails).toEqual({ stop: 'unsupported' })
    })

    test('handles multiple parameters with mixed validity', () => {
      const rules: ModelParameterRule[] = [
        { name: 'temperature', type: 'float', min: 0, max: 2, label: { en_US: 'Temperature', zh_Hans: '温度' }, required: false },
        { name: 'max_tokens', type: 'int', min: 1, max: 4096, label: { en_US: 'Max Tokens', zh_Hans: '最大标记' }, required: false },
        { name: 'model', type: 'string', options: ['gpt-4'], label: { en_US: 'Model', zh_Hans: '模型' }, required: false },
      ]
      const oldParams: FormValue = {
        temperature: 0.7,
        max_tokens: 5000,
        model: 'gpt-4',
        unsupported: 'value',
      }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({
        temperature: 0.7,
        model: 'gpt-4',
      })
      expect(result.removedDetails).toEqual({
        max_tokens: 'out of range (1-4096)',
        unsupported: 'unsupported',
      })
    })

    test('handles parameters without min/max constraints', () => {
      const rules: ModelParameterRule[] = [
        { name: 'value', type: 'int', label: { en_US: 'Value', zh_Hans: '值' }, required: false },
      ]
      const oldParams: FormValue = { value: 999999 }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({ value: 999999 })
      expect(result.removedDetails).toEqual({})
    })

    test('removes parameter with unsupported rule type', () => {
      const rules: ModelParameterRule[] = [
        { name: 'custom', type: 'unknown_type', label: { en_US: 'Custom', zh_Hans: '自定义' }, required: false } as any,
      ]
      const oldParams: FormValue = { custom: 'value' }
      const result = mergeValidCompletionParams(oldParams, rules)

      expect(result.params).toEqual({})
      expect(result.removedDetails.custom).toContain('unsupported rule type')
    })
  })
})
