import type { NodeDefault } from '../../types'
import type { BodyPayload, HttpNodeType } from './types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { AuthorizationType, BodyType, Method } from './types'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Utilities,
  sort: 1,
  type: BlockEnum.HttpRequest,
})
const nodeDefault: NodeDefault<HttpNodeType> = {
  metaData,
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
    ssl_verify: true,
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
  checkValid(payload: HttpNodeType, t: any) {
    let errorMessages = ''

    if (!errorMessages && !payload.url)
      errorMessages = t('errorMsg.fieldRequired', { ns: 'workflow', field: t('nodes.http.api', { ns: 'workflow' }) })

    if (!errorMessages
      && payload.body.type === BodyType.binary
      && ((!(payload.body.data as BodyPayload)[0]?.file) || (payload.body.data as BodyPayload)[0]?.file?.length === 0)
    ) {
      errorMessages = t('errorMsg.fieldRequired', { ns: 'workflow', field: t('nodes.http.binaryFileVariable', { ns: 'workflow' }) })
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
