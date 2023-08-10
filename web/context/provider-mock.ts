export const mockTextGenerationModelList = [
  {
    model_name: 'gpt-3.5-turbo',
    model_type: 'text-generation',
    model_provider: {
      provider_name: 'openai',
      provider_type: 'system',
    },
    features: ['agent_thought'],
  },
  {
    model_name: 'gpt-3.5-turbo-16k',
    model_type: 'text-generation',
    model_provider: {
      provider_name: 'openai',
      provider_type: 'system',
    },
    features: [],
  },
  {
    model_name: 'gpt-3.5-turbo',
    model_type: 'text-generation',
    model_provider: {
      provider_name: 'azure_openai',
      provider_type: 'custom',
    },
    features: ['agent_thought'],
  },
]
