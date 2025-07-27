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
        id: 'approve-action',
        name: 'approve',
        text: 'Post to X',
        type: UserActionButtonType.Primary,
      },
      {
        id: 'regenerate-action',
        name: 'regenerate',
        text: 'regenerate',
        type: UserActionButtonType.Default,
      },
      {
        id: 'thinking-action',
        name: 'thinking',
        text: 'think more',
        type: UserActionButtonType.Accent,
      },
      {
        id: 'cancel-action',
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
