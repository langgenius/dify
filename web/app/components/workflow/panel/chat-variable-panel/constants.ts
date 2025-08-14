import { ChatVarType } from './type'

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
export const typeList = [
  ChatVarType.String,
  ChatVarType.Number,
  ChatVarType.Object,
  ChatVarType.ArrayString,
  ChatVarType.ArrayNumber,
  ChatVarType.ArrayObject,
  'memory',
]
