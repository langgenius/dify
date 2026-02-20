import type { ModelProvider } from '../../declarations'
import { renderHook } from '@testing-library/react'
import { useCanAddedModels, useCustomModels } from './use-custom-models'

describe('useCustomModels and useCanAddedModels', () => {
  it('extracts custom models from provider correctly', () => {
    const mockProvider = {
      custom_configuration: {
        custom_models: [
          { model: 'gpt-4', model_type: 'text-generation' },
          { model: 'gpt-3.5', model_type: 'text-generation' },
        ],
      },
    } as unknown as ModelProvider

    const { result } = renderHook(() => useCustomModels(mockProvider))
    expect(result.current).toHaveLength(2)
    expect(result.current[0].model).toBe('gpt-4')

    const { result: emptyRes } = renderHook(() => useCustomModels({ custom_configuration: {} } as unknown as ModelProvider))
    expect(emptyRes.current).toEqual([])
  })

  it('extracts can_added_models from provider correctly', () => {
    const mockProvider = {
      custom_configuration: {
        can_added_models: [{ model: 'gpt-4-turbo', model_type: 'text-generation' }],
      },
    } as unknown as ModelProvider

    const { result } = renderHook(() => useCanAddedModels(mockProvider))
    expect(result.current).toHaveLength(1)
    expect(result.current[0].model).toBe('gpt-4-turbo')

    const { result: emptyRes } = renderHook(() => useCanAddedModels({ custom_configuration: {} } as unknown as ModelProvider))
    expect(emptyRes.current).toEqual([])
  })
})
