import type { TriggerProviderApiEntity as GeneratedTriggerProvider } from '@dify/contracts/api/console/workspaces/types.gen'
import { describe, expect, it } from 'vitest'
import { convertToTriggerWithProvider, normalizeTriggerProvider } from '../use-triggers'

const createGeneratedTriggerProvider = (): GeneratedTriggerProvider => ({
  author: 'Dify',
  name: 'github',
  label: { en_US: 'GitHub' },
  description: { en_US: 'GitHub trigger provider' },
  tags: ['source-control'],
  events: [
    {
      name: 'issue_created',
      identity: {
        author: 'Dify',
        name: 'issue_created',
        label: { en_US: 'Issue created' },
        provider: 'github',
      },
      description: { en_US: 'Issue created event' },
      parameters: [
        {
          name: 'retry_count',
          label: { en_US: 'Retry count' },
          type: 'number',
          default: 0,
          required: false,
          multiple: false,
        },
      ],
      output_schema: {},
    },
  ],
})

describe('trigger provider normalization', () => {
  it('should preserve falsy event parameter defaults', () => {
    const normalizedProvider = normalizeTriggerProvider(createGeneratedTriggerProvider())
    const triggerWithProvider = convertToTriggerWithProvider(normalizedProvider)

    expect(normalizedProvider.events[0]?.parameters[0]?.default).toBe(0)
    expect(triggerWithProvider.events[0]?.parameters[0]?.default).toBe(0)
  })
})
