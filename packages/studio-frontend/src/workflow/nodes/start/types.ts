import type { CommonNodeType, InputVar } from '../../types'

export type StartNodeType = CommonNodeType & {
  variables: InputVar[]
}
