import type { TFunction } from 'i18next'
import type { NodeDefault } from '../../types'
import type { DeliveryMethod, EmailConfig, HumanInputNodeType } from './types'
import { BlockClassification } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import {
  buildHumanInputOutputVars,
  getHumanInputSharedValidationError,
} from './shared/default-utils'
import { DeliveryMethodType } from './types'

const i18nPrefix = 'nodes.humanInput.errorMsg'

const metaData = genNodeMetaData({
  classification: BlockClassification.Logic,
  sort: 1,
  type: BlockEnum.HumanInput,
})

const isEmailConfigComplete = (config?: EmailConfig): boolean => {
  if (!config) return false

  if (!config.subject?.trim() || !config.body?.trim()) return false

  if (!/\{\{#url#\}\}/.test(config.body.trim())) return false

  return !!config.recipients?.whole_workspace || !!config.recipients?.items?.length
}

const hasIncompleteEnabledEmailConfig = (deliveryMethods: DeliveryMethod[]): boolean => {
  return deliveryMethods.some((method) => {
    return (
      method.enabled &&
      method.type === DeliveryMethodType.Email &&
      !isEmailConfigComplete(method.config)
    )
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
  checkValid(payload: HumanInputNodeType, t: TFunction<'workflow'>) {
    let errorMessages = ''
    if (!errorMessages && !payload.delivery_methods.length)
      errorMessages = t(($) => $[`${i18nPrefix}.noDeliveryMethod`], { ns: 'workflow' })

    if (
      !errorMessages &&
      payload.delivery_methods.length > 0 &&
      !payload.delivery_methods.some((method) => method.enabled)
    )
      errorMessages = t(($) => $[`${i18nPrefix}.noDeliveryMethodEnabled`], { ns: 'workflow' })

    if (!errorMessages && hasIncompleteEnabledEmailConfig(payload.delivery_methods))
      errorMessages = t(($) => $[`${i18nPrefix}.emailConfigIncomplete`], { ns: 'workflow' })

    if (!errorMessages) errorMessages = getHumanInputSharedValidationError(payload, t)

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
  getOutputVars(payload, _allPluginInfoList, _ragVars) {
    return buildHumanInputOutputVars(payload.inputs)
  },
}

export default nodeDefault
