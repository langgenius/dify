const allParams = {
  openai: {
    'gpt-3.5-turbo': {
      max_tokens: {
        enabled: true,
        min: 0,
        max: 4000,
        default: null,
      },
      temperature: {
        enabled: true,
        min: 0,
        max: 2,
        default: null,
      },
      top_p: {
        enabled: true,
        min: 0,
        max: 1,
        default: null,
      },
      presence_penalty: {
        enabled: true,
        min: -2,
        max: 2,
        default: null,
      },
      frequency_penalty: {
        enabled: true,
        min: -2,
        max: 2,
        default: null,
      },
    },
    'gpt-3.5-turbo-16k': {
      max_tokens: {
        enabled: true,
        min: 0,
        max: 8000,
        default: null,
      },
      temperature: { // test render
        enabled: true,
        min: 0,
        max: 5,
        default: null,
      },
      top_p: {
        enabled: true,
        min: 0,
        max: 1,
        default: null,
      },
      presence_penalty: {
        enabled: true,
        min: -2,
        max: 2,
        default: null,
      },
      frequency_penalty: { // test not enabled
        enabled: false,
        min: -2,
        max: 2,
        default: null,
      },
    },
  },
}

export default allParams
