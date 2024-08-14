import type { CommonNodeType, InputVar } from '@/app/components/workflow/types'

export type StartNodeType = CommonNodeType & {
  variables: InputVar[]
}
