import type { NodeDefault } from '../../types'
import type { HumanInputNodeType } from './types'
import { DeliveryMethodType, UserActionButtonType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'

const i18nPrefix = 'workflow.nodes.humanInput.errorMsg'

const nodeDefault: NodeDefault<HumanInputNodeType> = {
  defaultValue: {
    delivery_methods: [
      {
        type: DeliveryMethodType.WebApp,
        enabled: true,
      },
      {
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
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : []
    return nodes
  },
  getAvailableNextNodes() {
    const nodes = ALL_CHAT_AVAILABLE_BLOCKS
    return nodes
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
