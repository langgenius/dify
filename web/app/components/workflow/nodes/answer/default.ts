import type { NodeDefault } from '../../types'
import type { AnswerNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'

const nodeDefault: NodeDefault<AnswerNodeType> = {
  defaultValue: {
    variables: [],
    answer: '',
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
