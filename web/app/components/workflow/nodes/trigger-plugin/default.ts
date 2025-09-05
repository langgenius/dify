import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import type { PluginTriggerNodeType } from './types'
import { ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'

const nodeDefault: NodeDefault<PluginTriggerNodeType> = {
  defaultValue: {
    config: {},
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
  checkValid(payload: PluginTriggerNodeType, t: any) {
    if (!payload.provider_name || !payload.tool_name) {
      return {
        isValid: false,
        errorMessage: t('workflow.errorMsg.fieldRequired', { field: 'plugin' }),
      }
    }

    if (payload.paramSchemas && payload.paramSchemas.length > 0) {
      const requiredParams = payload.paramSchemas.filter(param => param.required)
      const config = payload.config || {}

      for (const param of requiredParams) {
        if (!config[param.name] || config[param.name] === '') {
          return {
            isValid: false,
            errorMessage: t('workflow.errorMsg.fieldRequired', { field: param.name }),
          }
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
