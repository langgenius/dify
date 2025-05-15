import type { NodeDefault, Var } from '../../types'
import { getNotExistVariablesByArray } from '../../utils/workflow'
import { CodeLanguage, type CodeNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'

const i18nPrefix = 'workflow.errorMsg'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Transform,
  sort: 1,
  type: BlockEnum.Code,
})
const nodeDefault: NodeDefault<CodeNodeType> = {
  metaData,
  defaultValue: {
    code: '',
    code_language: CodeLanguage.python3,
    variables: [],
    outputs: {},
  },
  checkValid(payload: CodeNodeType, t: any) {
    let errorMessages = ''
    const { code, variables } = payload
    if (!errorMessages && variables.filter(v => !v.variable).length > 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variable`) })
    if (!errorMessages && variables.filter(v => !v.value_selector.length).length > 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variableValue`) })
    if (!errorMessages && !code)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.code`) })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
  checkVarValid(payload: CodeNodeType, varMap: Record<string, Var>, t: any) {
    const errorMessageArr = []

    const variables_selector = payload.variables.map(v => v.value_selector)
    const variables_selector_warnings = getNotExistVariablesByArray(variables_selector, varMap)
    if (variables_selector_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.code.inputVars')} ${t('workflow.common.referenceVar')}${variables_selector_warnings.join('、')}${t('workflow.common.noExist')}`)

    return {
      isValid: true,
      warning_vars: variables_selector_warnings,
      errorMessage: errorMessageArr,
    }
  },
}

export default nodeDefault
