import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import { genNodeMetaData } from '../../utils'
import type { WebhookTriggerNodeType } from './types'
import { isValidParameterType } from './utils/parameter-type-utils'

const metaData = genNodeMetaData({
  sort: 3,
  type: BlockEnum.TriggerWebhook,
})

const nodeDefault: NodeDefault<WebhookTriggerNodeType> = {
  metaData,
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
  checkValid(payload: WebhookTriggerNodeType, t: any) {
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
