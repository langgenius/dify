import { VarType } from '@/app/components/workflow/types'

/**
 * Variable types that can be interpolated into a text field.
 *
 * `number` and `integer` both render as a plain literal, so the surrounding
 * text is unaffected; `secret` is text as well. Types that need a structured
 * editor (object, array, file, boolean) are not included.
 */
const TEXT_VAR_TYPES: readonly VarType[] = [
  VarType.string,
  VarType.number,
  VarType.integer,
  VarType.secret,
]

export const isTextVarType = (type: VarType) => TEXT_VAR_TYPES.includes(type)
