import { describe, expect, it } from 'vitest'
import {
  dslAppName,
  dslEnvVarSlots,
} from '../dsl'

describe('deployment DSL helpers', () => {
  // Scenario: release DSL should preserve env var metadata that is absent from deployment options today.
  describe('Environment variables', () => {
    it('should parse environment variable descriptions and default values from workflow DSL', () => {
      const slots = dslEnvVarSlots(`
app:
  name: Demo App
workflow:
  environment_variables:
    - name: API_KEY
      value: sk-demo
      value_type: secret
      description: Runtime API key
    - name: RETRY_COUNT
      value: 3
      value_type: number
      description: Retry count
`)

      expect(slots).toEqual([
        {
          key: 'API_KEY',
          description: 'Runtime API key',
          defaultValue: 'sk-demo',
        },
        {
          key: 'RETRY_COUNT',
          description: 'Retry count',
          defaultValue: '3',
        },
      ])
    })

    it('should ignore invalid variables and masked secret placeholders', () => {
      const slots = dslEnvVarSlots(`
workflow:
  environment_variables:
    - name: SECRET
      value: '[__HIDDEN__]'
      description: Secret value
    - name: EMPTY
      value: ''
    - value: missing name
    - name: OBJECT_VALUE
      default_value:
        nested: true
`)

      expect(slots).toEqual([
        {
          key: 'SECRET',
          description: 'Secret value',
        },
        {
          key: 'EMPTY',
        },
        {
          key: 'OBJECT_VALUE',
          defaultValue: '{"nested":true}',
        },
      ])
    })
  })

  // Scenario: source DSL app name is reused as the default deployment instance name.
  describe('App metadata', () => {
    it('should parse the app name from DSL metadata', () => {
      expect(dslAppName('app:\n  name: "  Demo App  "\n')).toBe('Demo App')
      expect(dslAppName('workflow: {}\n')).toBe('')
      expect(dslAppName('app: [')).toBe('')
    })
  })
})
