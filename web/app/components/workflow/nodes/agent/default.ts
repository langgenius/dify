import type { StrategyDetail, StrategyPluginDetail } from '@/app/components/plugins/types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'
import type { NodeDefault } from '../../types'
import type { AgentNodeType } from './types'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { renderI18nObject } from '@/hooks/use-i18n'

const nodeDefault: NodeDefault<AgentNodeType> = {
  defaultValue: {
  },
  getAvailablePrevNodes(isChatMode) {
    return isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS
  },
  getAvailableNextNodes(isChatMode) {
    return isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS
  },
  checkValid(payload, t, moreDataForCheckValid: {
    strategyProvider?: StrategyPluginDetail,
    strategy?: StrategyDetail
    language: string
    isReadyForCheckValid: boolean
  }) {
    const { strategy, language, isReadyForCheckValid } = moreDataForCheckValid
    if (!isReadyForCheckValid) {
      return {
        isValid: true,
        errorMessage: '',
      }
    }
    if (!strategy) {
      return {
        isValid: false,
        errorMessage: t('workflow.nodes.agent.checkList.strategyNotSelected'),
      }
    }
    for (const param of strategy.parameters) {
      // single tool
      if (param.required && param.type === FormTypeEnum.toolSelector) {
        // no value
        const toolValue = payload.agent_parameters?.[param.name]?.value
        if (!toolValue) {
          return {
            isValid: false,
            errorMessage: t('workflow.errorMsg.fieldRequired', { field: renderI18nObject(param.label, language) }),
          }
        }
        // not enabled
        else if (!toolValue.enabled) {
          return {
            isValid: false,
            errorMessage: t('workflow.errorMsg.noValidTool', { field: renderI18nObject(param.label, language) }),
          }
        }
        // check form of tool
        else {
          const schemas = toolValue.schemas || []
          const userSettings = toolValue.settings
          const reasoningConfig = toolValue.parameters
          schemas.forEach((schema: any) => {
            if (schema?.required) {
              if (schema.form === 'form' && !userSettings[schema.name]?.value) {
                return {
                  isValid: false,
                  errorMessage: t('workflow.errorMsg.toolParameterRequired', { field: renderI18nObject(param.label, language), param: renderI18nObject(schema.label, language) }),
                }
              }
              if (schema.form === 'llm' && reasoningConfig[schema.name].auto === 0 && !userSettings[schema.name]?.value) {
                return {
                  isValid: false,
                  errorMessage: t('workflow.errorMsg.toolParameterRequired', { field: renderI18nObject(param.label, language), param: renderI18nObject(schema.label, language) }),
                }
              }
            }
          })
        }
      }
      // multiple tools
      if (param.required && param.type === FormTypeEnum.multiToolSelector) {
        const tools = payload.agent_parameters?.[param.name]?.value || []
        // no value
        if (!tools.length) {
          return {
            isValid: false,
            errorMessage: t('workflow.errorMsg.fieldRequired', { field: renderI18nObject(param.label, language) }),
          }
        }
        // not enabled
        else if (tools.every((tool: any) => !tool.enabled)) {
          return {
            isValid: false,
            errorMessage: t('workflow.errorMsg.noValidTool', { field: renderI18nObject(param.label, language) }),
          }
        }
        // check form of tools
        else {
          let validState = {
            isValid: true,
            errorMessage: '',
          }
          for (const tool of tools) {
            const schemas = tool.schemas || []
            const userSettings = tool.settings
            const reasoningConfig = tool.parameters
            schemas.forEach((schema: any) => {
              if (schema?.required) {
                if (schema.form === 'form' && !userSettings[schema.name]?.value) {
                  return validState = {
                    isValid: false,
                    errorMessage: t('workflow.errorMsg.toolParameterRequired', { field: renderI18nObject(param.label, language), param: renderI18nObject(schema.label, language) }),
                  }
                }
                if (schema.form === 'llm' && reasoningConfig[schema.name]?.auto === 0 && !reasoningConfig[schema.name]?.value) {
                  return validState = {
                    isValid: false,
                    errorMessage: t('workflow.errorMsg.toolParameterRequired', { field: renderI18nObject(param.label, language), param: renderI18nObject(schema.label, language) }),
                  }
                }
              }
            })
          }
          return validState
        }
      }
      // common params
      if (param.required && !payload.agent_parameters?.[param.name]?.value) {
        return {
          isValid: false,
          errorMessage: t('workflow.errorMsg.fieldRequired', { field: renderI18nObject(param.label, language) }),
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
