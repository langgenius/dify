import type { NodeDefault, Var } from '../../types'
import type { HumanInputNodeType } from './types'
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
  checkValid(payload: HumanInputNodeType, t: (str: string, options: Record<string, unknown>) => string) {
    let errorMessages = ''
    if (!errorMessages && !payload.delivery_methods.length)
      errorMessages = t(`${i18nPrefix}.noDeliveryMethod`, { ns: 'workflow' })

    if (!errorMessages && payload.delivery_methods.length > 0 && !payload.delivery_methods.some(method => method.enabled))
      errorMessages = t(`${i18nPrefix}.noDeliveryMethodEnabled`, { ns: 'workflow' })

    if (!errorMessages && !payload.user_actions.length)
      errorMessages = t(`${i18nPrefix}.noUserActions`, { ns: 'workflow' })

    if (!errorMessages && payload.user_actions.length > 0) {
      const actionIds = payload.user_actions.map(action => action.id)
      const hasDuplicateIds = actionIds.length !== new Set(actionIds).size
      if (hasDuplicateIds)
        errorMessages = t(`${i18nPrefix}.duplicateActionId`, { ns: 'workflow' })
    }

    if (!errorMessages && payload.user_actions.length > 0) {
      const hasEmptyId = payload.user_actions.some(action => !action.id?.trim())
      if (hasEmptyId)
        errorMessages = t(`${i18nPrefix}.emptyActionId`, { ns: 'workflow' })
    }

    if (!errorMessages && payload.user_actions.length > 0) {
      const hasEmptyTitle = payload.user_actions.some(action => !action.title?.trim())
      if (hasEmptyTitle)
        errorMessages = t(`${i18nPrefix}.emptyActionTitle`, { ns: 'workflow' })
    }

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
