import type { SelectorParam, TFunction } from 'i18next'
import type { NodeDefault } from '../../types'
import type { VariableAssignerNodeType } from './types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { VarType } from '../../types'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Transform,
  sort: 3,
  type: BlockEnum.VariableAggregator,
})

type VariableFieldKey = 'errorMsg.fields.variableValue'

const variableFieldSelectors: Record<VariableFieldKey, SelectorParam<'workflow'>> = {
  'errorMsg.fields.variableValue': $ => $['errorMsg.fields.variableValue'],
}

const nodeDefault: NodeDefault<VariableAssignerNodeType> = {
  metaData,
  defaultValue: {
    output_type: VarType.any,
    variables: [],
  },
  checkValid(payload: VariableAssignerNodeType, t: TFunction<'workflow'>) {
    let errorMessages = ''
    const { variables, advanced_settings } = payload
    const { group_enabled = false, groups = [] } = advanced_settings || {}
    // enable group
    const validateVariables = (variables: any[], field: VariableFieldKey) => {
      variables.forEach((variable) => {
        if (!variable || variable.length === 0)
          errorMessages = t($ => $['errorMsg.fieldRequired'], { ns: 'workflow', field: t(variableFieldSelectors[field], { ns: 'workflow' }) })
      })
    }

    if (group_enabled) {
      if (!groups || groups.length === 0) {
        errorMessages = t($ => $['errorMsg.fieldRequired'], { ns: 'workflow', field: t($ => $['nodes.variableAssigner.title'], { ns: 'workflow' }) })
      }
      else if (!errorMessages) {
        groups.forEach((group) => {
          validateVariables(group.variables || [], 'errorMsg.fields.variableValue')
        })
      }
    }
    else {
      if (!variables || variables.length === 0)
        errorMessages = t($ => $['errorMsg.fieldRequired'], { ns: 'workflow', field: t($ => $['nodes.variableAssigner.title'], { ns: 'workflow' }) })
      else if (!errorMessages)
        validateVariables(variables, 'errorMsg.fields.variableValue')
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
