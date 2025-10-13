import { BlockEnum, VarType } from '../../types'
import type { NodeDefault } from '../../types'
import { comparisonOperatorNotRequireValue } from '../if-else/utils'
import { type ListFilterNodeType, OrderBy } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
const i18nPrefix = 'workflow.errorMsg'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Utilities,
  sort: 2,
  type: BlockEnum.ListFilter,
})
const nodeDefault: NodeDefault<ListFilterNodeType> = {
  metaData,
  defaultValue: {
    variable: [],
    filter_by: {
      enabled: false,
      conditions: [],
    },
    extract_by: {
      enabled: false,
      serial: '1',
    },
    order_by: {
      enabled: false,
      key: '',
      value: OrderBy.ASC,
    },
    limit: {
      enabled: false,
      size: 10,
    },
  },
  checkValid(payload: ListFilterNodeType, t: any) {
    let errorMessages = ''
    const { variable, var_type, filter_by, item_var_type } = payload

    if (!errorMessages && !variable?.length)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.listFilter.inputVar') })

    // Check filter condition
    if (!errorMessages && filter_by?.enabled) {
      if (var_type === VarType.arrayFile && !filter_by.conditions[0]?.key)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.listFilter.filterConditionKey') })

      if (!errorMessages && !filter_by.conditions[0]?.comparison_operator)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.listFilter.filterConditionComparisonOperator') })

      if (!errorMessages && !comparisonOperatorNotRequireValue(filter_by.conditions[0]?.comparison_operator) && (item_var_type === VarType.boolean ? filter_by.conditions[0]?.value === undefined : !filter_by.conditions[0]?.value))
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.listFilter.filterConditionComparisonValue') })
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
