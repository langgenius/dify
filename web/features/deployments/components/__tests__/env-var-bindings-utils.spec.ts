import { describe, expect, it } from 'vitest'
import {
  envVarValuesWithDefaults,
  mergeEnvVarSlotMetadata,
  selectedDeploymentEnvVars,
} from '../env-var-bindings-utils'

describe('deployment environment variable helpers', () => {
  // Scenario: backend required slots define order, while DSL metadata fills the missing UI details.
  describe('Slot metadata', () => {
    it('should merge DSL metadata into required environment variable slots', () => {
      expect(
        mergeEnvVarSlotMetadata(
          [
            { key: 'API_KEY' },
            { key: 'REGION' },
          ],
          [
            {
              key: 'REGION',
              description: 'Deployment region',
              defaultValue: 'us-east-1',
            },
            {
              key: 'IGNORED',
              description: 'Not required',
              defaultValue: 'ignored',
            },
          ],
        ),
      ).toEqual([
        { key: 'API_KEY' },
        {
          key: 'REGION',
          description: 'Deployment region',
          defaultValue: 'us-east-1',
        },
      ])
    })
  })

  // Scenario: defaults should prefill blank fields without replacing user input.
  describe('Default values', () => {
    it('should fill missing values and keep user-provided values', () => {
      const values = envVarValuesWithDefaults(
        {
          API_KEY: 'manual-key',
          EMPTY_INPUT: '',
        },
        [
          {
            key: 'API_KEY',
            defaultValue: 'default-key',
          },
          {
            key: 'EMPTY_INPUT',
            defaultValue: 'default-empty',
          },
          {
            key: 'REGION',
            defaultValue: 'us-east-1',
          },
        ],
      )

      expect(values).toEqual({
        API_KEY: 'manual-key',
        EMPTY_INPUT: '',
        REGION: 'us-east-1',
      })
    })

    it('should only submit non-empty selected environment variables', () => {
      expect(
        selectedDeploymentEnvVars(
          [
            { key: 'API_KEY' },
            { key: 'EMPTY_INPUT' },
          ],
          {
            API_KEY: 'manual-key',
            EMPTY_INPUT: '   ',
          },
        ),
      ).toEqual([
        {
          key: 'API_KEY',
          value: 'manual-key',
        },
      ])
    })
  })
})
