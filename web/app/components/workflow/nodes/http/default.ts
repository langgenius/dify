import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import { AuthorizationType, BodyType, Method } from './types'
import type { BodyPayload, HttpNodeType } from './types'
import {
  ALL_CHAT_AVAILABLE_BLOCKS,
  ALL_COMPLETION_AVAILABLE_BLOCKS,
} from '@/app/components/workflow/constants'
import { MAX_RETRIES_DEFAULT_HTTP_NODE, MAX_RETRIES_UPPER_BOUND_HTTP_NODE, RETRY_ENABLED_DEFAULT_HTTP_NODE, RETRY_INTERVAL_DEFAULT_HTTP_NODE, RETRY_INTERVAL_UPPER_BOUND_HTTP_NODE } from '@/config'

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
      retry_enabled: RETRY_ENABLED_DEFAULT_HTTP_NODE,
      max_retries: MAX_RETRIES_DEFAULT_HTTP_NODE,
      retry_interval: RETRY_INTERVAL_DEFAULT_HTTP_NODE,
      max_retries_upper_bound: MAX_RETRIES_UPPER_BOUND_HTTP_NODE,
      retry_interval_upper_bound: RETRY_INTERVAL_UPPER_BOUND_HTTP_NODE,
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
