import type { Var } from '../../types'
import { type NodeDefault, VarType } from '../../types'
import { getNotExistVariablesByArray } from '../../utils/workflow'
import type { VariableAssignerNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'

const i18nPrefix = 'workflow'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Transform,
  sort: 3,
  type: BlockEnum.VariableAggregator,
})
const nodeDefault: NodeDefault<VariableAssignerNodeType> = {
  metaData,
  defaultValue: {
    output_type: VarType.any,
    variables: [],
  },
  checkValid(payload: VariableAssignerNodeType, t: any) {
    let errorMessages = ''
    const { variables, advanced_settings } = payload
    const { group_enabled = false, groups = [] } = advanced_settings || {}
    // enable group
    const validateVariables = (variables: any[], field: string) => {
      variables.forEach((variable) => {
        if (!variable || variable.length === 0)
          errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(field) })
      })
    }

    if (group_enabled) {
      if (!groups || groups.length === 0) {
        errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.variableAssigner.title`) })
      }
      else if (!errorMessages) {
        groups.forEach((group) => {
          validateVariables(group.variables || [], `${i18nPrefix}.errorMsg.fields.variableValue`)
        })
      }
    }
    else {
      if (!variables || variables.length === 0)
        errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.variableAssigner.title`) })
      else if (!errorMessages)
        validateVariables(variables, `${i18nPrefix}.errorMsg.fields.variableValue`)
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
  checkVarValid(payload: VariableAssignerNodeType, varMap: Record<string, Var>, t: any) {
    const errorMessageArr: string[] = []
    const variables_warnings = getNotExistVariablesByArray(payload.variables ?? [], varMap)
    if (variables_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.variableAssigner.title')} ${t('workflow.common.referenceVar')}${variables_warnings.join('、')}${t('workflow.common.noExist')}`)

    return {
      isValid: true,
      warning_vars: variables_warnings,
      errorMessage: errorMessageArr,
    }
  },
}

export default nodeDefault
