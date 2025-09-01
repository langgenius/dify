import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import type { WebhookTriggerNodeType } from './types'
import { ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'

const nodeDefault: NodeDefault<WebhookTriggerNodeType> = {
  defaultValue: {
    webhook_url: '',
    method: 'POST',
    content_type: 'application/json',
    headers: [],
    params: [],
    body: [],
    async_mode: true,
    status_code: 200,
    response_body: '',
  },
  getAvailablePrevNodes(_isChatMode: boolean) {
    return []
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? []
      : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes.filter(type => type !== BlockEnum.Start)
  },
  checkValid(_payload: WebhookTriggerNodeType, _t: any) {
    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
