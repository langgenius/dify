import type { NodeDefault, Var } from '../../types'
import type { HumanInputNodeType } from './types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
// import { DeliveryMethodType, UserActionButtonType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

const i18nPrefix = 'workflow.nodes.humanInput.errorMsg'

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
      errorMessages = t(`${i18nPrefix}.noDeliveryMethod`)

    if (!errorMessages && payload.delivery_methods.length > 0 && !payload.delivery_methods.some(method => method.enabled))
      errorMessages = t(`${i18nPrefix}.noDeliveryMethodEnabled`)

    if (!errorMessages && !payload.form_content)
      errorMessages = t(`${i18nPrefix}.noFormContent`)

    if (!errorMessages && payload.form_content) {
      const regex = /\{\{#\$output\.[^#]+#\}\}/
      if (!regex.test(payload.form_content))
        errorMessages = t(`${i18nPrefix}.noFormInputField`)
    }

    if (!errorMessages && !payload.user_actions.length)
      errorMessages = t(`${i18nPrefix}.noUserActions`)

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
