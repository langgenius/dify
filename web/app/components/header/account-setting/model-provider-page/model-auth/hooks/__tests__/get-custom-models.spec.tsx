import type { ModelProvider } from '../../../declarations'
import { getCanAddedModels, getCustomModels } from '../get-custom-models'

describe('getCustomModels and getCanAddedModels', () => {
  it('extracts custom models from provider correctly', () => {
    const mockProvider = {
      custom_configuration: {
        custom_models: [
          { model: 'gpt-4', model_type: 'text-generation' },
          { model: 'gpt-3.5', model_type: 'text-generation' },
        ],
      },
    } as unknown as ModelProvider

    const result = getCustomModels(mockProvider)
    expect(result).toHaveLength(2)
    expect(result[0]!.model).toBe('gpt-4')

    const emptyRes = getCustomModels({ custom_configuration: {} } as unknown as ModelProvider)
    expect(emptyRes).toEqual([])
  })

  it('extracts can_added_models from provider correctly', () => {
    const mockProvider = {
      custom_configuration: {
        can_added_models: [{ model: 'gpt-4-turbo', model_type: 'text-generation' }],
      },
    } as unknown as ModelProvider

    const result = getCanAddedModels(mockProvider)
    expect(result).toHaveLength(1)
    expect(result[0]!.model).toBe('gpt-4-turbo')

    const emptyRes = getCanAddedModels({ custom_configuration: {} } as unknown as ModelProvider)
    expect(emptyRes).toEqual([])
  })
})
