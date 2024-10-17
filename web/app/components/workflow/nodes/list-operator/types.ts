import type { ComparisonOperator } from '../if-else/types'
import type { CommonNodeType, ValueSelector, VarType } from '@/app/components/workflow/types'

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
  comparison_operator: ComparisonOperator
  value: string | number | string[]
}

export type ListFilterNodeType = CommonNodeType & {
  variable: ValueSelector
  var_type: VarType // Cache for the type of output variable
  item_var_type: VarType // Cache for the type of output variable
  filter_by: {
    enabled: boolean
    conditions: Condition[]
  }
  order_by: {
    enabled: boolean
    key: ValueSelector | string
    value: OrderBy
  }
  limit: Limit
}
