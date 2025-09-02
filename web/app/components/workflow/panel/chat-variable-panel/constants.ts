import { ChatVarType } from './type'
import { DEFAULT_OBJECT_VALUE } from '@/app/components/workflow/panel/chat-variable-panel/components/object-value-item'

export const objectPlaceholder = `#  example
#  {
#     "name": "ray",
#     "age": 20
#  }`
export const arrayStringPlaceholder = `#  example
#  [
#     "value1",
#     "value2"
#  ]`
export const arrayNumberPlaceholder = `#  example
#  [
#     100,
#     200
#  ]`
export const arrayObjectPlaceholder = `#  example
#  [
#     {
#       "name": "ray",
#       "age": 20
#     },
#     {
#       "name": "lily",
#       "age": 18
#     }
#  ]`
export const arrayBoolPlaceholder = `#  example
#  [
#     "True",
#     "False"
#  ]`
export const typeList = [
  ChatVarType.String,
  ChatVarType.Number,
  ChatVarType.Boolean,
  ChatVarType.Object,
  ChatVarType.ArrayString,
  ChatVarType.ArrayNumber,
  ChatVarType.ArrayBoolean,
  ChatVarType.ArrayObject,
  ChatVarType.Memory,
]

export const TYPE_STRING_DEFAULT_VALUE = ''
export const TYPE_NUMBER_DEFAULT_VALUE = 0
export const TYPE_BOOLEAN_DEFAULT_VALUE = false
export const TYPE_OBJECT_DEFAULT_VALUE = [DEFAULT_OBJECT_VALUE]
export const TYPE_ARRAY_STRING_DEFAULT_VALUE = [undefined]
export const TYPE_ARRAY_NUMBER_DEFAULT_VALUE = [undefined]
export const TYPE_ARRAY_OBJECT_DEFAULT_VALUE = undefined
export const TYPE_ARRAY_BOOLEAN_DEFAULT_VALUE = [false]
