import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'

export enum OrderBy {
  ASC = 'asc',
  DESC = 'desc',
}

export type Limit = {
  enabled: boolean
  size?: number
}

export type ListFilterNodeType = CommonNodeType & {
  variable: ValueSelector
  filterBy: []
  orderBy: {
    enabled: boolean
    key: ValueSelector | string
    value: OrderBy
  }
  limit: Limit
}
