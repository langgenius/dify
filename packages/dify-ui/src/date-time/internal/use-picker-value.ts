import type { BaseUIChangeEventDetails } from '@base-ui/react/types'
import { useFieldRootContext } from '@base-ui/react/internals/field-root-context'
import { useControlled } from '@base-ui/utils/useControlled'

type PickerChangeEventReason = 'item-press' | 'clear-press' | 'reset'
type PickerChangeEventDetails = BaseUIChangeEventDetails<PickerChangeEventReason>

function arePickerValuesEqual(first: unknown, second: unknown) {
  return first instanceof Date && second instanceof Date
    ? first.getTime() === second.getTime()
    : first === second
}

function usePickerValue<Value extends string | Date>({
  value: valueProp,
  defaultValue,
  onValueChange,
  disabled,
  readOnly,
  name,
}: {
  value: Value | null | undefined
  defaultValue: Value | null
  onValueChange: ((value: Value | null, details: PickerChangeEventDetails) => void) | undefined
  disabled: boolean | undefined
  readOnly: boolean | undefined
  name: string
}) {
  const field = useFieldRootContext()
  const [value, setValue] = useControlled({ controlled: valueProp, default: defaultValue, name })

  function commit(next: Value | null, details: PickerChangeEventDetails) {
    if (details.reason !== 'reset' && (disabled || field.disabled || readOnly)) return false
    if (arePickerValuesEqual(next, value)) return true
    onValueChange?.(next, details)
    if (details.isCanceled) return false
    setValue(next)
    return true
  }

  return { value, commit }
}

export { arePickerValuesEqual, usePickerValue }
export type { PickerChangeEventDetails, PickerChangeEventReason }
