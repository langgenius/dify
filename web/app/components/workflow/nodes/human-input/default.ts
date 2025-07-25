import type { NodeDefault } from '../../types'
import type { HumanInputNodeType } from './types'
import { DeliveryMethodType, UserActionButtonType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'

const nodeDefault: NodeDefault<HumanInputNodeType> = {
  defaultValue: {
    deliveryMethod: [
      {
        type: DeliveryMethodType.WebApp,
        enabled: true,
      },
      {
        type: DeliveryMethodType.Email,
        enabled: false,
      },
    ],
    userActions: [
      {
        name: 'approve',
        text: 'Post to X',
        type: UserActionButtonType.Primary,
      },
      {
        name: 'regenerate',
        text: 'regenerate',
        type: UserActionButtonType.Default,
      },
      {
        name: 'thinking',
        text: 'think more',
        type: UserActionButtonType.Accent,
      },
      {
        name: 'cancel',
        text: 'cancel',
        type: UserActionButtonType.Ghost,
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
