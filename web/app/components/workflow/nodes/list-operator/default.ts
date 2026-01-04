import type { NodeDefault } from '../../types'
import type { ListFilterNodeType } from './types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum, VarType } from '../../types'
import { comparisonOperatorNotRequireValue } from '../if-else/utils'
import { OrderBy } from './types'

const i18nPrefix = 'errorMsg'

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
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.listFilter.inputVar', { ns: 'workflow' }) })

    // Check filter condition
    if (!errorMessages && filter_by?.enabled) {
      if (var_type === VarType.arrayFile && !filter_by.conditions[0]?.key)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.listFilter.filterConditionKey', { ns: 'workflow' }) })

      if (!errorMessages && !filter_by.conditions[0]?.comparison_operator)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.listFilter.filterConditionComparisonOperator', { ns: 'workflow' }) })

      if (!errorMessages && !comparisonOperatorNotRequireValue(filter_by.conditions[0]?.comparison_operator) && (item_var_type === VarType.boolean ? filter_by.conditions[0]?.value === undefined : !filter_by.conditions[0]?.value))
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.listFilter.filterConditionComparisonValue', { ns: 'workflow' }) })
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
