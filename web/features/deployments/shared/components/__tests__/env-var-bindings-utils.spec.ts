import type { EnvVarSlot } from '@dify/contracts/enterprise/types.gen'
import { EnvVarValueType } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import { envVarBindingSlotFromContract, envVarBindingValueType } from '../env-var-bindings-utils'

function slot(overrides: Partial<EnvVarSlot>): EnvVarSlot {
  return {
    key: 'API_KEY',
    valueType: EnvVarValueType.ENV_VAR_VALUE_TYPE_STRING,
    description: '',
    ...overrides,
  }
}

describe('env var binding value type normalization', () => {
  it('should normalize generated and DSL value types', () => {
    expect(envVarBindingValueType(EnvVarValueType.ENV_VAR_VALUE_TYPE_NUMBER)).toBe('number')
    expect(envVarBindingValueType('number')).toBe('number')
    expect(envVarBindingValueType(EnvVarValueType.ENV_VAR_VALUE_TYPE_SECRET)).toBe('secret')
    expect(envVarBindingValueType('secret')).toBe('secret')
    expect(envVarBindingValueType(EnvVarValueType.ENV_VAR_VALUE_TYPE_STRING)).toBe('string')
    expect(envVarBindingValueType()).toBe('string')
  })
})

describe('env var contract slot conversion', () => {
  it('should trim keys and preserve default and last value availability', () => {
    expect(
      envVarBindingSlotFromContract(
        slot({
          key: '  API_TOKEN  ',
          valueType: EnvVarValueType.ENV_VAR_VALUE_TYPE_SECRET,
          defaultValue: '',
          lastValue: 'previous',
        }),
      ),
    ).toMatchObject({
      key: 'API_TOKEN',
      valueType: 'secret',
      hasDefaultValue: true,
      hasLastValue: true,
    })
  })

  it('should ignore blank keys and mark absent values as unavailable', () => {
    expect(envVarBindingSlotFromContract(slot({ key: '   ' }))).toBeUndefined()
    expect(
      envVarBindingSlotFromContract(
        slot({ key: 'PORT', valueType: EnvVarValueType.ENV_VAR_VALUE_TYPE_NUMBER }),
      ),
    ).toMatchObject({
      key: 'PORT',
      valueType: 'number',
      hasDefaultValue: false,
      hasLastValue: false,
    })
  })
})
