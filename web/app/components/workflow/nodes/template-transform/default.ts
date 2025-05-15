import type { NodeDefault, Var } from '../../types'
import { getNotExistVariablesByArray } from '../../utils/workflow'
import type { TemplateTransformNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
const i18nPrefix = 'workflow.errorMsg'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Transform,
  sort: 2,
  type: BlockEnum.TemplateTransform,
  helpLinkUri: 'template',
})
const nodeDefault: NodeDefault<TemplateTransformNodeType> = {
  metaData,
  defaultValue: {
    template: '',
    variables: [],
  },
  checkValid(payload: TemplateTransformNodeType, t: any) {
    let errorMessages = ''
    const { template, variables } = payload

    if (!errorMessages && variables.filter(v => !v.variable).length > 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variable`) })
    if (!errorMessages && variables.filter(v => !v.value_selector.length).length > 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variableValue`) })
    if (!errorMessages && !template)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.templateTransform.code') })
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
  checkVarValid(payload: TemplateTransformNodeType, varMap: Record<string, Var>, t: any) {
    const errorMessageArr = []

    const variables_selector = payload.variables.map(v => v.value_selector)
    const variables_selector_warnings = getNotExistVariablesByArray(variables_selector, varMap)
    if (variables_selector_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.templateTransform.inputVars')} ${t('workflow.common.referenceVar')}${variables_selector_warnings.join('、')}${t('workflow.common.noExist')}`)

    return {
      isValid: true,
      errorMessage: errorMessageArr,
    }
  },
}

export default nodeDefault
