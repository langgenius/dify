import type { NodeDefault } from '../../types'
import type { HumanInputNodeType } from './types'
import { DeliveryMethodType, UserActionButtonType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'

const i18nPrefix = 'workflow.nodes.humanInput.errorMsg'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Logic,
  sort: 1,
  type: BlockEnum.HumanInput,
})

const nodeDefault: NodeDefault<HumanInputNodeType> = {
  metaData,
  defaultValue: {
    delivery_methods: [
      {
        id: 'webapp-method',
        type: DeliveryMethodType.WebApp,
        enabled: true,
      },
      {
        id: 'email-method',
        type: DeliveryMethodType.Email,
        enabled: false,
      },
    ],
    user_actions: [
      {
        id: 'approve-action',
        title: 'Post to X',
        button_style: UserActionButtonType.Primary,
      },
      {
        id: 'regenerate-action',
        title: 'regenerate',
        button_style: UserActionButtonType.Default,
      },
      {
        id: 'thinking-action',
        title: 'thinking',
        button_style: UserActionButtonType.Accent,
      },
      {
        id: 'cancel-action',
        title: 'cancel',
        button_style: UserActionButtonType.Ghost,
      },
    ],
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
}

export default nodeDefault
