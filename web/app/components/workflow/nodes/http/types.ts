import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export type HttpNodeType = CommonNodeType & {
  variables: Variable[]
  method: string
  url: string
  headers: string
  params: string
  body: {
    type: string
    data: string
  }
}
