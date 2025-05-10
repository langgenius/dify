import { BlockEnum } from '../../types'
import type { NodeDefault, Var } from '../../types'
import { getNotExistVariablesByArray, getNotExistVariablesByText } from '../../utils/workflow'
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
  checkVarValid(payload: HttpNodeType, varMap: Record<string, Var>, t: any) {
    const errorMessageArr: string[] = []
    const url_warnings = getNotExistVariablesByText(payload.url, varMap)
    if (url_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.http.api')} ${t('workflow.common.referenceVar')}${url_warnings.join('、')}${t('workflow.common.noExist')}`)

    const headers_warnings = getNotExistVariablesByText(payload.headers, varMap)
    if (headers_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.http.headers')} ${t('workflow.common.referenceVar')}${headers_warnings.join('、')}${t('workflow.common.noExist')}`)

    const params_warnings = getNotExistVariablesByText(payload.params, varMap)
    if (params_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.http.params')} ${t('workflow.common.referenceVar')}${params_warnings.join('、')}${t('workflow.common.noExist')}`)

    const body_warnings: string[] = []

    if ([BodyType.binary].includes(payload.body.type)) {
      const body_data = payload.body.data as BodyPayload
      body_data.forEach((item) => {
        const key_warnings = getNotExistVariablesByText(item.key || '', varMap)
        if (key_warnings.length)
          body_warnings.push(...key_warnings)
        const warnings = getNotExistVariablesByArray([item.file || []], varMap)
        if (warnings.length)
          body_warnings.push(...warnings)
      })
    }
    else {
      const body_data = payload.body.data as BodyPayload
      body_data.forEach((item) => {
        const key_warnings = getNotExistVariablesByText(item.key || '', varMap)
        if (key_warnings.length)
          body_warnings.push(...key_warnings)
        const value_warnings = getNotExistVariablesByText(item.value || '', varMap)
        if (value_warnings.length)
          body_warnings.push(...value_warnings)
      })
    }
    if (body_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.http.body')} ${t('workflow.common.referenceVar')}${body_warnings.join('、')}${t('workflow.common.noExist')}`)

    return {
      isValid: true,
      warning_vars: [...url_warnings, ...headers_warnings, ...params_warnings, ...body_warnings],
      errorMessage: errorMessageArr,
    }
  },
}

export default nodeDefault
