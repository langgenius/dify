import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import type { WebhookTriggerNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'

const nodeDefault: NodeDefault<WebhookTriggerNodeType> = {
  defaultValue: {
    webhook_url: '',
    http_methods: ['POST'],
    authorization: {
      type: 'none',
    },
  },
  getAvailablePrevNodes(isChatMode: boolean) {
    return []
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.End)
    return nodes.filter(type => type !== BlockEnum.Start)
  },
  checkValid(payload: WebhookTriggerNodeType, t: any) {
    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
