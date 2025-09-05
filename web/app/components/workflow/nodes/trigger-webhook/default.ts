import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import type { WebhookTriggerNodeType } from './types'
import { isValidParameterType } from './utils/parameter-type-utils'
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
  checkValid(payload: WebhookTriggerNodeType, t: any) {
    // Validate webhook configuration
    if (!payload.webhook_url) {
      return {
        isValid: false,
        errorMessage: t('workflow.nodes.triggerWebhook.validation.webhookUrlRequired'),
      }
    }

    // Validate parameter types for params and body
    const parametersWithTypes = [
      ...(payload.params || []),
      ...(payload.body || []),
    ]

    for (const param of parametersWithTypes) {
      // Validate parameter type is valid
      if (!isValidParameterType(param.type)) {
        return {
          isValid: false,
          errorMessage: t('workflow.nodes.triggerWebhook.validation.invalidParameterType', {
            name: param.name,
            type: param.type,
          }),
        }
      }
    }

    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
