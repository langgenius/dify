import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import { AuthorizationType, BodyType, Method } from './types'
import type { BodyPayload, HttpNodeType } from './types'
import {
  ALL_CHAT_AVAILABLE_BLOCKS,
  ALL_COMPLETION_AVAILABLE_BLOCKS,
} from '@/app/components/workflow/blocks'

const nodeDefault: NodeDefault<HttpNodeType> = {
  defaultValue: {
    variables: [],
    method: Method.get,
    url: '',
    authorization: {
      type: AuthorizationType.none,
      config: null,
    },
    headers: '',
    params: '',
    body: {
      type: BodyType.none,
      data: [],
    },
    timeout: {
      max_connect_timeout: 0,
      max_read_timeout: 0,
      max_write_timeout: 0,
    },
    retry_config: {
      retry_enabled: true,
      max_retries: 3,
      retry_interval: 100,
    },
  },
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.End)
    return nodes
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode ? ALL_CHAT_AVAILABLE_BLOCKS : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes
  },
  checkValid(payload: HttpNodeType, t: any) {
    let errorMessages = ''

    if (!errorMessages && !payload.url)
      errorMessages = t('workflow.errorMsg.fieldRequired', { field: t('workflow.nodes.http.api') })

    if (!errorMessages
        && payload.body.type === BodyType.binary
        && ((!(payload.body.data as BodyPayload)[0]?.file) || (payload.body.data as BodyPayload)[0]?.file?.length === 0)
    )
      errorMessages = t('workflow.errorMsg.fieldRequired', { field: t('workflow.nodes.http.binaryFileVariable') })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
