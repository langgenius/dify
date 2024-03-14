import type { NodeDefault } from '../../types'
import { type EndNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'

const nodeDefault: NodeDefault<EndNodeType> = {
  defaultValue: {
    outputs: [],
  },
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode ? ALL_CHAT_AVAILABLE_BLOCKS : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
