import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'

export enum OrderBy {
  ASC = 'asc',
  DESC = 'desc',
}

export type Limit = {
  enabled: boolean
  size?: number
}

export type Condition = {
  key: string
  comparison_operator: string
  value: string
}

export type ListFilterNodeType = CommonNodeType & {
  variable: ValueSelector
  filter_by: Condition[]
  order_by: {
    enabled: boolean
    key: ValueSelector | string
    value: OrderBy
  }
  limit: Limit
}
