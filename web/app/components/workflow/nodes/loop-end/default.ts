import type { NodeDefault } from '../../types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'
import type {
  SimpleNodeType,
} from '@/app/components/workflow/simple-node/types'

const nodeDefault: NodeDefault<SimpleNodeType> = {
  defaultValue: {},
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode ? ALL_CHAT_AVAILABLE_BLOCKS : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes
  },
  getAvailableNextNodes() {
    return []
  },
  checkValid() {
    return {
      isValid: true,
    }
  },
}

export default nodeDefault
