import type { EnvVarValues } from '../env-var-bindings-utils'
import { EnvVarValueSource as ApiEnvVarValueSource } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import { dslEnvVarSlots } from '../../dsl'
import {
  envVarSlotsWithoutDefaultValues,
  envVarSlotsWithoutLastDeploymentValues,
  envVarSlotValueType,
  envVarValueSelectionForSlot,
  envVarValuesWithDefaults,
  hasMissingRequiredEnvVarValue,
  mergeEnvVarSlotMetadata,
  selectedDeploymentEnvVars,
} from '../env-var-bindings-utils'

describe('env-var-bindings-utils', () => {
  // Deployment option slots can carry raw values from the backend.
  describe('backend slot values', () => {
    it('should use lastValue as an available last deployment source', () => {
      const slot = {
        key: 'API_KEY',
        lastValue: 'plain-secret',
        valueType: 'secret',
      }

      const selection = envVarValueSelectionForSlot(slot)

      expect(selection).toEqual({
        valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT,
      })
      expect(hasMissingRequiredEnvVarValue(slot, { API_KEY: selection })).toBe(false)
      expect(selectedDeploymentEnvVars([slot], { API_KEY: selection })).toEqual([
        {
          key: 'API_KEY',
          valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT,
        },
      ])
    })

    it('should remove last deployment values when creating a new deployment', () => {
      const slot = {
        key: 'API_KEY',
        defaultValue: 'release-default',
        hasDefaultValue: true,
        lastValue: 'previous-value',
        hasLastValue: true,
      }

      const createDeploymentSlots = envVarSlotsWithoutLastDeploymentValues([slot])
      const values = envVarValuesWithDefaults({}, createDeploymentSlots, { preferDefaultValue: true })

      expect(createDeploymentSlots).toEqual([
        {
          key: 'API_KEY',
          defaultValue: 'release-default',
          hasDefaultValue: true,
        },
      ])
      expect(values.API_KEY).toEqual({
        valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT,
      })
      expect(selectedDeploymentEnvVars(createDeploymentSlots, values)).toEqual([
        {
          key: 'API_KEY',
          valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT,
        },
      ])
    })

    it('should remove default values when deploying an existing release', () => {
      const slot = {
        key: 'API_KEY',
        defaultValue: 'release-default',
        hasDefaultValue: true,
        lastValue: 'previous-value',
        hasLastValue: true,
      }

      const existingReleaseSlots = envVarSlotsWithoutDefaultValues([slot])
      const values = envVarValuesWithDefaults({}, existingReleaseSlots)

      expect(existingReleaseSlots).toEqual([
        {
          key: 'API_KEY',
          lastValue: 'previous-value',
          hasLastValue: true,
        },
      ])
      expect(values.API_KEY).toEqual({
        valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT,
      })
      expect(selectedDeploymentEnvVars(existingReleaseSlots, values)).toEqual([
        {
          key: 'API_KEY',
          valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT,
        },
      ])
    })
  })

  // Number variables still submit string values, but invalid manual input must not pass validation.
  describe('number variables', () => {
    it('should reject invalid literal number values', () => {
      const slot = {
        key: 'RETRIES',
        valueType: 'number',
      }
      const values: EnvVarValues = {
        RETRIES: {
          valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL,
          value: 'not-a-number',
        },
      }

      expect(envVarSlotValueType(slot)).toBe('number')
      expect(hasMissingRequiredEnvVarValue(slot, values)).toBe(true)
      expect(selectedDeploymentEnvVars([slot], values)).toEqual([])
    })
  })

  // Imported DSL metadata fills in release defaults before the deployment options are submitted.
  describe('dsl metadata', () => {
    it('should preserve typed default metadata when merging deployment option slots', () => {
      const metadataSlots = dslEnvVarSlots(`
app:
  mode: workflow
workflow:
  environment_variables:
    - name: RETRIES
      value_type: number
      default: 3
    - name: API_KEY
      value_type: secret
      value: '[__HIDDEN__]'
`)

      const mergedSlots = mergeEnvVarSlotMetadata(
        [
          {
            key: 'RETRIES',
            hasLastValue: true,
            lastValue: '2',
          },
          {
            key: 'API_KEY',
          },
        ],
        metadataSlots,
      )

      expect(mergedSlots).toEqual([
        {
          key: 'RETRIES',
          hasLastValue: true,
          lastValue: '2',
          valueType: 'number',
          hasDefaultValue: true,
          defaultValue: '3',
        },
        {
          key: 'API_KEY',
          valueType: 'secret',
        },
      ])
    })
  })
})
