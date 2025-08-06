import type { NodeDefault } from '../../types'
import type { HumanInputNodeType } from './types'
import { DeliveryMethodType, UserActionButtonType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'

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
    timeout: {
      value: 3,
      unit: 'days',
    },
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
  checkValid() {
    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
