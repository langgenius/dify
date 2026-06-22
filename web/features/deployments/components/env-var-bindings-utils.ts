import type { EnvVarSlot } from '@dify/contracts/enterprise/types.gen'
import type { EnvVarBindingSlot } from './env-var-bindings'

export function envVarBindingValueType(valueType?: EnvVarSlot['valueType'] | string): EnvVarBindingSlot['valueType'] {
  switch (valueType) {
    case 'ENV_VAR_VALUE_TYPE_NUMBER':
    case 'number':
      return 'number'
    case 'ENV_VAR_VALUE_TYPE_SECRET':
    case 'secret':
      return 'secret'
    default:
      return 'string'
  }
}

export function envVarBindingSlotFromContract(slot: EnvVarSlot): EnvVarBindingSlot | undefined {
  const key = slot.key.trim()
  if (!key)
    return undefined

  return {
    ...slot,
    key,
    valueType: envVarBindingValueType(slot.valueType),
    hasDefaultValue: slot.defaultValue !== undefined,
    hasLastValue: slot.lastValue !== undefined,
  }
}
