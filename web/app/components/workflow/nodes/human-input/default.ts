import type { NodeDefault } from '../../types'
import type { HumanInputNodeType } from './types'
import { DeliveryMethodType } from './types'
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
    userActions: [],
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
