import type { NodeDefault, Var } from '../../types'
import type { HumanInputNodeType } from './types'
import { splitByOutputVar } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

const i18nPrefix = 'nodes.humanInput.errorMsg'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Logic,
  sort: 1,
  type: BlockEnum.HumanInput,
})

const buildOutputVars = (variables: string[]): Var[] => {
  return variables.map((variable) => {
    return {
      variable,
      type: VarType.string,
    }
  })
}

const checkInputFields = (formContent: string): boolean => {
  const outputVarRegex = /\{\{#\$output\.[^#]+#\}\}/
  const contentList = splitByOutputVar(formContent)
  return contentList.filter(content => outputVarRegex.test(content)).length > 0
}

const nodeDefault: NodeDefault<HumanInputNodeType> = {
  metaData,
  defaultValue: {
    delivery_methods: [],
    user_actions: [],
    form_content: '',
    inputs: [],
    timeout: 3,
    timeout_unit: 'day',
  },
  checkValid(payload: HumanInputNodeType, t: any) {
    let errorMessages = ''
    if (!errorMessages && !payload.delivery_methods.length)
      errorMessages = t(`${i18nPrefix}.noDeliveryMethod`, { ns: 'workflow' })

    if (!errorMessages && payload.delivery_methods.length > 0 && !payload.delivery_methods.some(method => method.enabled))
      errorMessages = t(`${i18nPrefix}.noDeliveryMethodEnabled`, { ns: 'workflow' })

    if (!errorMessages && !payload.form_content.trim())
      errorMessages = t(`${i18nPrefix}.noFormContent`, { ns: 'workflow' })

    if (!errorMessages && !checkInputFields(payload.form_content))
      errorMessages = t(`${i18nPrefix}.noFormContentInputField`, { ns: 'workflow' })

    if (!errorMessages && !payload.user_actions.length)
      errorMessages = t(`${i18nPrefix}.noUserActions`, { ns: 'workflow' })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
  getOutputVars(payload, _allPluginInfoList, _ragVars) {
    const variables = payload.inputs.map(input => input.output_variable_name)
    return buildOutputVars(variables)
  },
}

export default nodeDefault
